from datetime import datetime, timedelta
import numpy as np
import xarray as xr
import pandas as pd
import json
from metpy.calc import lat_lon_grid_deltas, vorticity, smooth_gaussian
from metpy.units import units

EARTH_R = 6_371_000.0

def wrap_dlon_deg(dlon):
    return (dlon + 180.0) % 360.0 - 180.0

EARTH_R = 6_371_000.0  # meters

def storm_motion_uv_ms(
    time_str: str,
    track_latlon_fn,
    hours: float = 6.0,
    centered: bool = True,
) -> tuple[float, float]:
    """
    Storm translation (u, v) in m/s from a track function: track_latlon_fn(iso_str)->(lat,lon).

    centered=True  : uses +/- hours/2 (less noisy)
    centered=False : uses (t-hours)->t (pure "past 6h" motion)
    """
    t = datetime.fromisoformat(time_str.replace("Z", ""))

    if centered:
        h = hours / 2.0
        t0, t1 = t - timedelta(hours=h), t + timedelta(hours=h)
        denom_s = hours * 3600.0
    else:
        t0, t1 = t - timedelta(hours=hours), t
        denom_s = hours * 3600.0

    lat0, lon0 = track_latlon_fn(t0.isoformat())
    lat1, lon1 = track_latlon_fn(t1.isoformat())

    latm = np.deg2rad(0.5 * (lat0 + lat1))
    dlat = np.deg2rad(lat1 - lat0)
    dlon = np.deg2rad(wrap_dlon_deg(lon1 - lon0))

    # local tangent-plane displacement (good enough for ~hundreds of km)
    dx_m = EARTH_R * np.cos(latm) * dlon  # east+
    dy_m = EARTH_R * dlat                 # north+

    return float(dx_m / denom_s), float(dy_m / denom_s)


def storm_influence_radius_and_mask(
    u, v, lats, lons,
    ref_lat, ref_lon,                       # seed for center finder
    *,
    time_str: str | None = None,
    track_latlon_fn=None,                   # track_latlon_fn(time_str)->(lat,lon)
    use_storm_motion: bool = False,
    motion_hours: float = 6.0,
    motion_centered: bool = True,
    # center-finder params
    search_km: float = 300.0,
    smooth_sigma: float = 1.0,
    smooth_iters: int = 1,
    # ring params
    dr_km: float = 25.0,
    r_min_km: float = 50.0,
    r_max_km: float = 1500.0,
    require_consecutive: int = 2,
    # decision params
    expected_sign: int = +1,                # +1 means cyclonic is positive (NH under your convention)
    coherence_thresh: float = 0.60,
    bg_band_km: tuple[float, float] = (1200.0, 1500.0),
    bg_margin_ms: float = 3.0,
    vtan_mask_thresh_ms: float = 10.0,
):
    """
    Goal: identify storm-rotational wind to mask out, leaving environmental flow.

    Returns dict with:
      center_lat, center_lon,
      r_influence_km,
      ring_centers_km, strength_medabs, coherence_frac,
      storm_mask (2D bool), Vtan (2D)
    """
    U = np.asarray(u, dtype=float)
    V = np.asarray(v, dtype=float)
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)

    # 1) Level-specific center (your existing function)
    center_lat, center_lon, offset_km, zeta_val = find_era5_center_from_uv(
        U, V, lats, lons,
        ref_lat=ref_lat, ref_lon=ref_lon,
        search_km=search_km,
        smooth_sigma=smooth_sigma,
        smooth_iters=smooth_iters,
    )

    # 2) Optionally subtract storm motion (storm-relative wind)
    if use_storm_motion:
        if time_str is None or track_latlon_fn is None:
            raise ValueError("use_storm_motion=True requires time_str and track_latlon_fn.")
        u_mot, v_mot = storm_motion_uv_ms(
            time_str, track_latlon_fn, hours=motion_hours, centered=motion_centered
        )
        Ueff = U - u_mot
        Veff = V - v_mot
    else:
        Ueff, Veff = U, V

    # 3) Tangential wind Vtan about the (level-specific) center
    Lon, Lat = np.meshgrid(lons, lats)

    lat0 = np.deg2rad(center_lat)
    dlat = np.deg2rad(Lat - center_lat)
    dlon = np.deg2rad(wrap_dlon_deg(Lon - center_lon))  # vectorized wrap works with numpy

    dx_km = (EARTH_R * np.cos(lat0) * dlon) / 1000.0
    dy_km = (EARTH_R * dlat) / 1000.0

    r_km = np.sqrt(dx_km * dx_km + dy_km * dy_km)
    r_km = np.where(r_km == 0, np.nan, r_km)
    
    tx = -dy_km / r_km
    ty =  dx_km / r_km
    Vtan = Ueff * tx + Veff * ty  # signed tangential m/s

    # 4) Ring stats (strength + coherence)
    edges = np.arange(0.0, r_max_km + dr_km, dr_km)
    centers = 0.5 * (edges[:-1] + edges[1:])
    strength = np.full_like(centers, np.nan, dtype=float)   # median(|Vtan|)
    coherence = np.full_like(centers, np.nan, dtype=float)  # fraction cyclonic

    sgn = float(expected_sign)
    for i in range(len(centers)):
        r0, r1 = edges[i], edges[i + 1]
        m = (r_km >= r0) & (r_km < r1) & np.isfinite(Vtan)
        if np.any(m):
            vt = Vtan[m]
            strength[i] = np.nanmedian(np.abs(vt))
            coherence[i] = np.mean((vt * sgn) > 0)

    # Background-based threshold for "storm strength"
    bg0, bg1 = bg_band_km
    bg_mask = (centers >= bg0) & (centers <= bg1) & np.isfinite(strength)
    bg = np.nanmedian(strength[bg_mask]) if np.any(bg_mask) else np.nanmedian(strength[np.isfinite(strength)])
    strength_thresh = bg + bg_margin_ms

    # 5) Influence radius: first radius where storm "ends" for N consecutive rings
    start_idx = np.searchsorted(centers, r_min_km)
    ended = (strength < strength_thresh) | (coherence < coherence_thresh)

    r_influence = None
    for i in range(start_idx, len(centers) - require_consecutive + 1):
        if np.all(ended[i:i + require_consecutive]):
            r_influence = centers[i]
            break
    if r_influence is None:
        r_influence = centers[-1]

    # 6) Grid mask: inside radius AND cyclonic AND |Vtan| large enough
    storm_mask = (
        (r_km <= r_influence) &
        np.isfinite(Vtan) &
        ((Vtan * sgn) > 0) &
        (np.abs(Vtan) >= vtan_mask_thresh_ms)
    )

    return {
        "center_lat": float(center_lat),
        "center_lon": float(center_lon),
        "noaa_to_era5_offset_km": float(offset_km),
        "zeta_at_center_1s": float(zeta_val),
        "r_influence_km": float(r_influence),
        "ring_centers_km": centers,
        "ring_strength_medabs_ms": strength,
        "ring_coherence_frac": coherence,
        "storm_mask": storm_mask,
        "Vtan": Vtan,
    }
    
def get_uv_at_level_time(ds, level, time):
    """
    Select u, v, lats, lons from an xarray Dataset at a given pressure level and time.

    Assumptions:
      - u and v are always shaped (nlat, nlon), e.g. (721, 1440)
      - latitude corresponds to axis 0
      - longitude corresponds to axis 1

    Normalization:
      - If lats are decreasing, flip lats and flip u/v along axis 0.
      - If lons are in [0, 360), convert to [-180, 180) and reorder u/v along axis 1.
    """
    sel = ds.sel(time=time, level=level)

    u = sel["u"].values
    v = sel["v"].values
    lats = sel["latitude"].values
    lons = sel["longitude"].values

    # ---- Latitude: ensure increasing (-90 -> 90) ----
    if len(lats) > 1 and lats[0] > lats[-1]:
        lats = lats[::-1]
        u = u[::-1, :]
        v = v[::-1, :]

    # ---- Longitude: ensure [-180, 180) instead of [0, 360) ----
    # Heuristic: if any lon > 180, treat as 0..360 convention.
    if len(lons) > 0 and np.nanmax(lons) > 180:
        lons_wrapped = ((lons + 180) % 360) - 180   # -> [-180, 180)
        order = np.argsort(lons_wrapped)

        lons = lons_wrapped[order]
        u = u[:, order]
        v = v[:, order]

    return u, v, lats, lons

def interp_storm_latlon(storm_df, time):
    t = pd.to_datetime(time)

    dt = storm_df["datetime"].values

    if t.to_datetime64() < dt[0] or t.to_datetime64() > dt[-1]:
        return None

    exact = storm_df.loc[storm_df["datetime"] == t]
    if len(exact) > 0:
        return float(exact["lat"].iloc[0]), float(exact["lon"].iloc[0])

    i = np.searchsorted(dt, t.to_datetime64(), side="right")
    i0, i1 = i - 1, i

    t0 = storm_df["datetime"].iloc[i0]
    t1 = storm_df["datetime"].iloc[i1]

    frac = (t - t0) / (t1 - t0)

    lat0, lat1 = storm_df["lat"].iloc[i0], storm_df["lat"].iloc[i1]
    lon0, lon1 = storm_df["lon"].iloc[i0], storm_df["lon"].iloc[i1]

    lat = float(lat0 + frac * (lat1 - lat0))
    lon = float(lon0 + frac * (lon1 - lon0))

    return lat, lon

def _approx_distance_km(lat, lon, lat0, lon0):
    km_per_deg = 111.32
    dx = (lon - lon0) * km_per_deg * np.cos(np.deg2rad(lat0))
    dy = (lat - lat0) * km_per_deg
    return np.sqrt(dx * dx + dy * dy)


def _sigma_to_n(sigma):
    """Convert a sigma (gridpoints) into MetPy's required odd window size n."""
    if sigma is None or sigma <= 0:
        return None
    n = int(np.ceil(6.0 * float(sigma) + 1.0))
    n = max(n, 3)
    if n % 2 == 0:
        n += 1
    return n


def find_era5_center_from_uv(
    u, v, lats, lons,
    ref_lat, ref_lon,
    search_km=300.0,
    smooth_sigma=1.0,
    smooth_iters=1,
):
    """
    Returns: (era_lat, era_lon, offset_km, zeta_at_center [1/s])
    """
    U = np.asarray(u)
    V = np.asarray(v)
    lats = np.asarray(lats)
    lons = np.asarray(lons)

    Lon2d, Lat2d = np.meshgrid(lons, lats)

    dx, dy = lat_lon_grid_deltas(Lon2d, Lat2d)  # meters

    zeta = vorticity(U * units("m/s"), V * units("m/s"), dx=dx, dy=dy)  # 1/s

    n = _sigma_to_n(smooth_sigma)
    if n is not None and int(smooth_iters) > 0:
        for _ in range(int(smooth_iters)):
            zeta = smooth_gaussian(zeta, n=n)

    z = np.asarray(zeta.magnitude)

    dist_km = _approx_distance_km(Lat2d, Lon2d, ref_lat, ref_lon)

    # Prefer cyclonic (NH positive) within radius
    cand = (dist_km <= search_km) & np.isfinite(z) & (z > 0)

    if np.any(cand):
        score = np.where(cand, z, np.nan)
        idx = np.nanargmax(score)
        i, j = np.unravel_index(idx, score.shape)
    else:
        # Fallback: max |zeta| within radius
        cand2 = (dist_km <= search_km) & np.isfinite(z)
        if not np.any(cand2):
            raise ValueError("No valid vorticity points found in search window.")
        score = np.where(cand2, np.abs(z), np.nan)
        idx = np.nanargmax(score)
        i, j = np.unravel_index(idx, score.shape)

    era_lat = float(lats[i])
    era_lon = float(lons[j])
    offset_km = float(_approx_distance_km(era_lat, era_lon, ref_lat, ref_lon))
    zeta_val = float(z[i, j])

    return era_lat, era_lon, offset_km, zeta_val

def track_latlon_fn(t_iso):
    return interp_storm_latlon(sandyCoords, t_iso)

allLevelsFile = '../data/sandy2012-windUV_all_levels_from_250_to_850-rechunked.zarr'
sandyCoordsFile = "../data/sandy2012-coords.csv"

allLevelsDs = xr.open_zarr(allLevelsFile, consolidated=False)
sandyCoords = pd.read_csv(sandyCoordsFile)
sandyCoords["datetime"] = pd.to_datetime(sandyCoords["datetime"])
sandyCoords = sandyCoords.sort_values("datetime").reset_index(drop=True)

sandyCoords["lat"] = sandyCoords["lat"].astype(float)
sandyCoords["lon"] = sandyCoords["lon"].astype(float)

start = datetime.fromisoformat("2012-10-22T00:00:00")
end   = datetime.fromisoformat("2012-10-31T12:00:00")

path = "./storm_influence_by_time_level.json"

out_started = False  # whether we've written at least one time entry yet

with open(path, "w") as f:
    f.write("{\n")
    f.flush()

    t = start
    while t <= end:
        time_str = t.strftime("%Y-%m-%dT%H:%M:%S")
        time_key = time_str + "Z"  # match your example keys

        ref_lat, ref_lon = interp_storm_latlon(sandyCoords, time_str)

        hour_obj = {}

        for level in allLevelsDs.level.values:
            lvl_key = f"{float(level):g}"  # "250", "500", "850", ...

            try:
                u, v, lats, lons = get_uv_at_level_time(allLevelsDs, level=float(level), time=time_str)

                out = storm_influence_radius_and_mask(
                    u, v, lats, lons,
                    ref_lat=ref_lat, ref_lon=ref_lon,
                    time_str=time_str,
                    track_latlon_fn=track_latlon_fn,
                    use_storm_motion=False,
                    motion_hours=6.0,
                    motion_centered=True,
                    dr_km=25.0,
                    r_min_km=50.0,
                    r_max_km=1500.0,
                    require_consecutive=2,
                    coherence_thresh=0.60,
                    bg_band_km=(1200.0, 1500.0),
                    bg_margin_ms=3.0,
                    vtan_mask_thresh_ms=10.0,
                    search_km=300.0,
                    smooth_sigma=1.0,
                    smooth_iters=1,
                )

                era_lat, era_lon = out["center_lat"], out["center_lon"]

                dlat_deg = float(era_lat - ref_lat)
                dlon_deg = float(wrap_dlon_deg(era_lon - ref_lon))
                r_km = float(out["r_influence_km"])

                exists = (
                    np.isfinite(r_km) and (r_km > 0) and
                    np.isfinite(dlat_deg) and np.isfinite(dlon_deg)
                )

                if not exists:
                    dlon_deg, dlat_deg, r_km = 0.0, 0.0, 0.0
                    
                dlon_deg = round(dlon_deg, 2)
                dlat_deg = round(dlat_deg, 2)
                r_km     = round(r_km, 2)

                hour_obj[lvl_key] = {
                    "exists": bool(exists),
                    "offsetCenter": [dlon_deg, dlat_deg],  # [lon_deg, lat_deg] = ERA5 - REF
                    "horizontalRadius": r_km,              # km
                }

            except Exception:
                hour_obj[lvl_key] = {
                    "exists": False,
                    "offsetCenter": [0.0, 0.0],
                    "horizontalRadius": 0.0,
                }

        # Stream-write this hour immediately
        if out_started:
            f.write(",\n")
        out_started = True

        f.write("  " + json.dumps(time_key) + ": " + json.dumps(hour_obj))
        f.flush()

        print("completed:", t)
        t += timedelta(hours=1)

    f.write("\n}\n")
    f.flush()

print("Wrote:", path)