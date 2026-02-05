#!/usr/bin/env python3
"""
jet_na_driver.py

Standalone script to:
1) load Sandy 2012 wind UV zarr + storm track CSV
2) for each 6h timestep from 2012-10-22T00:00:00 to 2012-10-31T12:00:00:
   - compute a jet mask at 250 hPa using jetness = speed * directional_coherence
   - plot (A) masked quiver (B) pruned skeleton over distance map (C) NA-selected edges over distance map

Assumptions:
- Your environment has all imports available (xarray/cartopy/skimage/scipy/etc)
- Your datasets have variables: u, v and coords: time, level, latitude, longitude
- Functions below are the "necessary" ones to run end-to-end.
"""

# =========================
# Imports (assumed valid)
# =========================
import numpy as np
import pandas as pd
import xarray as xr

import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

from scipy.ndimage import uniform_filter, gaussian_filter
from skimage.morphology import medial_axis
from collections import defaultdict
import json 

# =========================
# Constants / inputs
# =========================
ALL_LEVELS_FILE   = "../data/sandy2012-windUV_all_levels_from_250_to_850-rechunked.zarr"
SUBSET_LEVELS_FILE = "../data/sandy2012-windUV_250_500_850.zarr"
SANDY_COORDS_FILE  = "../data/sandy2012-coords.csv"

# --- ADD near your constants ---
OUTPUT_JSON = "./na_jet_lines_2012-10-22_to_2012-10-31_6h.json"


START_TIME = "2012-10-22T00:00:00"
END_TIME   = "2012-10-31T12:00:00"
FREQ       = "6H"

LEVEL_HPA  = 250

# Jetness / masking params
GAUSS_SIGMA  = 5
COH_SIZE     = 9
JET_PCT      = 75

# Skeleton pruning params
LEAF_PERCENTILE = 75

# North America selection params
NA_BBOX = (-170, -40, 20, 70)   # (lon_min, lon_max, lat_min, lat_max)
TOP_K = 8
MIN_INSIDE_FRAC = 0.30

# Quiver plotting
QUIVER_STRIDE = 10
QUIVER_EXTENT_GLOBAL = (-180, 180, -90, 90)
QUIVER_AX_EXTENT_SMALL = (-100, -60, 0, 30)

# =========================
# Minimal helpers (needed)
# =========================
def get_uv_at_level_time(ds, level, time):
    """
    Select u, v, lats, lons from an xarray Dataset at a given pressure level and time.

    Normalization:
      - If lats are decreasing, flip lats and flip u/v along axis 0.
      - If lons are in [0, 360), convert to [-180, 180) and reorder u/v along axis 1.
    """
    sel = ds.sel(time=time, level=level)

    u = sel["u"].values
    v = sel["v"].values
    lats = sel["latitude"].values
    lons = sel["longitude"].values

    # lat increasing
    if len(lats) > 1 and lats[0] > lats[-1]:
        lats = lats[::-1]
        u = u[::-1, :]
        v = v[::-1, :]

    # lon wrap to [-180, 180)
    if len(lons) > 0 and np.nanmax(lons) > 180:
        lons_wrapped = ((lons + 180) % 360) - 180
        order = np.argsort(lons_wrapped)
        lons = lons_wrapped[order]
        u = u[:, order]
        v = v[:, order]

    return u, v, lats, lons


def ensure_lonlat_2d(lats, lons, ref_2d):
    """
    Return Lon, Lat as 2D grids matching ref_2d.shape.
    - If lats/lons are 1D: meshgrid.
    - If they're already 2D: pass through.
    """
    lats = np.asarray(lats)
    lons = np.asarray(lons)

    if lats.ndim == 1 and lons.ndim == 1:
        Lon, Lat = np.meshgrid(lons, lats)
        return Lon, Lat

    if lats.ndim == 2 and lons.ndim == 2:
        return lons, lats  # assume inputs already Lon,Lat

    raise ValueError("Unexpected lon/lat dimensionality; expected both 1D or both 2D.")


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


def plot_wind_quiver_single_uv(
    u, v, lats, lons, *,
    time=None,
    stride=10,
    extent=None,
    max_speed_for_black=None,
    ax=None,
    title=None,
    storm_df=None,
    show_storm_dot=True,
    storm_dot_size=22,
    show_quiver=True,
):
    Lon, Lat = np.meshgrid(lons, lats)

    Lon_s = Lon[::stride, ::stride]
    Lat_s = Lat[::stride, ::stride]
    u_s   = u[::stride, ::stride]
    v_s   = v[::stride, ::stride]

    speed = np.sqrt(u_s**2 + v_s**2)

    if max_speed_for_black is None:
        max_speed_for_black = float(np.nanpercentile(speed, 95)) if np.isfinite(speed).any() else 1.0
        if max_speed_for_black <= 0:
            max_speed_for_black = 1.0

    if ax is None:
        fig = plt.figure(figsize=(6, 4))
        ax = plt.axes(projection=ccrs.PlateCarree())
    else:
        fig = None

    ax.set_facecolor("white")

    if extent is not None:
        lon_min, lon_max, lat_min, lat_max = extent
        ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())

    ax.add_feature(cfeature.COASTLINE, linewidth=0.8)

    if show_quiver:
        ax.quiver(
            Lon_s, Lat_s, u_s, v_s, speed,
            transform=ccrs.PlateCarree(),
            cmap="Greys",
            clim=(0.0, max_speed_for_black),
            scale=1500,
            width=0.0012,
            pivot="middle",
        )

    if show_storm_dot and storm_df is not None and time is not None:
        pt = interp_storm_latlon(storm_df, time)
        if pt is not None:
            lat_pt, lon_pt = pt
            ax.scatter([lon_pt], [lat_pt], transform=ccrs.PlateCarree(),
                       s=storm_dot_size, c="red", edgecolors="none", zorder=10)

            t_next = pd.to_datetime(time) + pd.Timedelta(hours=6)
            pt2 = interp_storm_latlon(storm_df, t_next)
            if pt2 is not None:
                lat2, lon2 = pt2
                ax.scatter([lon2], [lat2], transform=ccrs.PlateCarree(),
                           s=storm_dot_size, c="#ff9999", edgecolors="none", zorder=10)
                ax.plot([lon_pt, lon2], [lat_pt, lat2], transform=ccrs.PlateCarree(),
                        color="red", linewidth=1.5, zorder=9)

    if title is not None:
        ax.set_title(title)

    return fig, ax


def directional_coherence(u, v, size=9):
    spd = np.hypot(u, v)
    ux = np.where(spd > 0, u / spd, 0.0)
    vy = np.where(spd > 0, v / spd, 0.0)

    mx = uniform_filter(ux, size=size, mode="nearest")
    my = uniform_filter(vy, size=size, mode="nearest")

    return np.hypot(mx, my)


def get_jet_masked_uv_at_time(
    ds, timeStr, *,
    level=250,
    sigma=5,
    coh_size=9,
    pct=75,
):
    u, v, lats, lons = get_uv_at_level_time(ds, level=level, time=timeStr)

    u_s = gaussian_filter(u, sigma=sigma, mode="nearest")
    v_s = gaussian_filter(v, sigma=sigma, mode="nearest")

    coh = directional_coherence(u_s, v_s, size=coh_size)
    spd = np.hypot(u_s, v_s)
    jetness = spd * coh

    thr = np.nanpercentile(jetness, pct)
    jet_mask = jetness > thr

    u_masked = np.where(jet_mask, u, np.nan)
    v_masked = np.where(jet_mask, v, np.nan)

    return u_masked, v_masked, lats, lons, jet_mask, thr


# ============================================================
# Jet skeleton pruning (graph-based)
# Score(edge) = length * mean_speed * median_radius
# Iterative leaf pruning using percentile threshold on leaf scores
# ============================================================
_NEI8 = [(-1,-1), (-1,0), (-1,1),
         ( 0,-1),         ( 0,1),
         ( 1,-1), ( 1,0), ( 1,1)]

def neighbors8(y, x, mask):
    out = []
    for dy, dx in _NEI8:
        yy, xx = y+dy, x+dx
        if 0 <= yy < mask.shape[0] and 0 <= xx < mask.shape[1] and mask[yy, xx]:
            out.append((yy, xx))
    return out

def degree_map(mask):
    deg = np.zeros(mask.shape, dtype=np.uint8)
    yy, xx = np.where(mask)
    for y, x in zip(yy, xx):
        deg[y, x] = len(neighbors8(y, x, mask))
    return deg

def extract_edges(mask, dist_map, speed_map):
    deg = degree_map(mask)
    nodes = set(zip(*np.where((deg == 1) | (deg >= 3))))

    visited = set()
    edges = []

    def step_length(a, b):
        dy = abs(a[0]-b[0])
        dx = abs(a[1]-b[1])
        return np.sqrt(2.0) if (dy == 1 and dx == 1) else 1.0

    for node in list(nodes):
        for nb in neighbors8(node[0], node[1], mask):
            key = (node, nb)
            if key in visited:
                continue

            path = [node, nb]
            visited.add((node, nb))
            prev = node
            cur = nb

            while True:
                if cur in nodes:
                    break

                nbs = neighbors8(cur[0], cur[1], mask)
                nbs2 = [p for p in nbs if p != prev]

                if len(nbs2) == 0:
                    break
                if len(nbs2) >= 2:
                    nodes.add(cur)
                    break

                nxt = nbs2[0]
                visited.add((cur, nxt))
                path.append(nxt)
                prev, cur = cur, nxt

            node_a = path[0]
            node_b = path[-1]

            ys = np.array([p[0] for p in path], dtype=int)
            xs = np.array([p[1] for p in path], dtype=int)

            radii = dist_map[ys, xs].astype(float)
            spds  = speed_map[ys, xs].astype(float)

            L = 0.0
            for i in range(1, len(path)):
                L += step_length(path[i-1], path[i])

            mean_spd = np.nanmean(spds)
            med_rad  = np.nanmedian(radii)

            if not np.isfinite(mean_spd): mean_spd = 0.0
            if not np.isfinite(med_rad):  med_rad = 0.0

            score = L * mean_spd * med_rad

            edges.append({
                "a": node_a,
                "b": node_b,
                "pixels": path,
                "length": L,
                "mean_speed": mean_spd,
                "median_radius": med_rad,
                "score": score,
            })

    return edges

def build_adjacency(edges):
    adj = defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append((i, e["b"]))
        adj[e["b"]].append((i, e["a"]))
    return adj

def edge_is_leaf(edge_idx, edges, adj):
    e = edges[edge_idx]
    da = len(adj[e["a"]])
    db = len(adj[e["b"]])
    return (da == 1) ^ (db == 1) or (da == 1 and db == 1)

def remove_edge(edge_idx, edges, adj):
    e = edges[edge_idx]
    a, b = e["a"], e["b"]
    adj[a] = [(i, o) for (i, o) in adj[a] if i != edge_idx]
    adj[b] = [(i, o) for (i, o) in adj[b] if i != edge_idx]

def dedupe_edges_keep_best(edges):
    buckets = defaultdict(list)
    for e in edges:
        key = tuple(sorted((e["a"], e["b"])))
        buckets[key].append(e)

    deduped = []
    for _, lst in buckets.items():
        best = max(lst, key=lambda e: e["score"])
        deduped.append(best)
    return deduped

def prune_skeleton_by_leaf_percentile(
    skel_mask, dist_map, speed_map, *,
    leaf_percentile=20,
    min_leaf_score=None,
    max_iters=20000
):
    edges = extract_edges(skel_mask, dist_map, speed_map)
    edges = dedupe_edges_keep_best(edges)
    adj = build_adjacency(edges)

    alive = np.ones(len(edges), dtype=bool)
    if len(edges) == 0:
        return np.zeros_like(skel_mask, dtype=bool), [], []

    global_ref = np.nanpercentile([e["score"] for e in edges], leaf_percentile)

    for _ in range(max_iters):
        leaf_idxs = [i for i in range(len(edges)) if alive[i] and edge_is_leaf(i, edges, adj)]
        if len(leaf_idxs) == 0:
            break

        leaf_scores = np.array([edges[i]["score"] for i in leaf_idxs], dtype=float)
        if np.all(leaf_scores == 0):
            break
        if np.nanmin(leaf_scores) >= global_ref:
            break

        thr = np.nanpercentile(leaf_scores, leaf_percentile)
        if min_leaf_score is not None:
            thr = max(thr, float(min_leaf_score))

        remove_candidates = [i for i in leaf_idxs if edges[i]["score"] <= thr]
        if len(remove_candidates) == 0:
            break

        worst = min(remove_candidates, key=lambda i: edges[i]["score"])
        alive[worst] = False
        remove_edge(worst, edges, adj)

    out = np.zeros_like(skel_mask, dtype=bool)
    kept_edges = [edges[i] for i in range(len(edges)) if alive[i]]

    for e in kept_edges:
        for (y, x) in e["pixels"]:
            out[y, x] = True

    return out, kept_edges, edges


# ============================================================
# Score edges by how much of their polyline lies inside a bbox
# ============================================================
def _step_len(a, b):
    dy = abs(a[0] - b[0])
    dx = abs(a[1] - b[1])
    return np.sqrt(2.0) if (dy == 1 and dx == 1) else 1.0

def score_edge_inside_bbox(edge, Lon, Lat, *, bbox, use_midpoint=True,
                           weight=None, speed_map=None, dist_map=None):
    lon_min, lon_max, lat_min, lat_max = bbox
    pts = edge["pixels"]
    if len(pts) < 2:
        return 0.0, 0.0, 0.0

    inside_len = 0.0
    total_len = 0.0
    score = 0.0

    for i in range(1, len(pts)):
        (y0, x0) = pts[i-1]
        (y1, x1) = pts[i]
        seg_len = _step_len((y0, x0), (y1, x1))
        total_len += seg_len

        if use_midpoint:
            lonm = 0.5 * (Lon[y0, x0] + Lon[y1, x1])
            latm = 0.5 * (Lat[y0, x0] + Lat[y1, x1])
            inside = (lon_min <= lonm <= lon_max) and (lat_min <= latm <= lat_max)
        else:
            inside0 = (lon_min <= Lon[y0, x0] <= lon_max) and (lat_min <= Lat[y0, x0] <= lat_max)
            inside1 = (lon_min <= Lon[y1, x1] <= lon_max) and (lat_min <= Lat[y1, x1] <= lat_max)
            inside = inside0 and inside1

        if inside:
            inside_len += seg_len

            if weight in (None, "length"):
                score += seg_len
            elif weight == "length_speed_radius":
                if speed_map is None or dist_map is None:
                    raise ValueError("weight='length_speed_radius' requires speed_map and dist_map")
                spd_mid = 0.5 * (speed_map[y0, x0] + speed_map[y1, x1])
                rad_mid = 0.5 * (dist_map[y0, x0] + dist_map[y1, x1])
                if not np.isfinite(spd_mid): spd_mid = 0.0
                if not np.isfinite(rad_mid): rad_mid = 0.0
                score += seg_len * spd_mid * rad_mid
            else:
                raise ValueError(f"Unknown weight={weight}")

    return float(score), float(inside_len), float(total_len)

def score_and_filter_edges_by_bbox(
    edges, Lon, Lat, *,
    bbox,
    top_k=10,
    min_score=None,
    min_inside_frac=None,
    use_midpoint=True,
    weight="length",
    speed_map=None,
    dist_map=None,
    return_mask=True,
    mask_shape=None
):
    scored = []
    for i, e in enumerate(edges):
        s, Lin, Ltot = score_edge_inside_bbox(
            e, Lon, Lat, bbox=bbox, use_midpoint=use_midpoint,
            weight=weight, speed_map=speed_map, dist_map=dist_map
        )
        frac = (Lin / (Ltot + 1e-12)) if Ltot > 0 else 0.0
        scored.append({"edge_idx": i, "score": s, "inside_len": Lin, "total_len": Ltot, "inside_frac": frac})

    scored_sorted = sorted(scored, key=lambda d: d["score"], reverse=True)

    filtered = []
    for d in scored_sorted:
        if min_score is not None and d["score"] < float(min_score):
            continue
        if min_inside_frac is not None and d["inside_frac"] < float(min_inside_frac):
            continue
        filtered.append(d)

    if top_k is not None:
        filtered = filtered[:int(top_k)]

    selected_edges = [edges[d["edge_idx"]] for d in filtered]

    if not return_mask:
        return selected_edges, filtered

    if mask_shape is None:
        raise ValueError("mask_shape is required when return_mask=True")

    sel_mask = np.zeros(mask_shape, dtype=bool)
    for e in selected_edges:
        for (y, x) in e["pixels"]:
            sel_mask[y, x] = True

    return selected_edges, filtered, sel_mask

# --- ADD helper (anywhere above main) ---
def edge_pixels_to_latlon_line(edge, Lat, Lon):
    """
    Convert an edge (edge["pixels"] list of (y,x)) into a polyline:
    [[lat, lon], [lat, lon], ...]
    """
    line = []
    for (y, x) in edge["pixels"]:
        lat = float(Lat[y, x])
        lon = float(Lon[y, x])
        if np.isfinite(lat) and np.isfinite(lon):
            line.append([lat, lon])
    return line


# =========================
# One timestep: compute + plot row of 3 panels
# =========================
def run_one_time_and_plot(
    ds, storm_df, timeStr,
    *,
    level=LEVEL_HPA,
    sigma=GAUSS_SIGMA,
    coh_size=COH_SIZE,
    pct=JET_PCT,
    leaf_percentile=LEAF_PERCENTILE,
    na_bbox=NA_BBOX,
    top_k=TOP_K,
    min_inside_frac=MIN_INSIDE_FRAC,
):
    # jet masking
    u_masked, v_masked, lats, lons, jet_mask, thr = get_jet_masked_uv_at_time(
        ds, timeStr, level=level, sigma=sigma, coh_size=coh_size, pct=pct
    )

    # skeleton + distance to boundary
    ridge_skel, dist = medial_axis(jet_mask, return_distance=True)

    # Lon/Lat grids (2D)
    Lon, Lat = ensure_lonlat_2d(lats, lons, u_masked)

    # speed map (NaN outside jet)
    speed = np.sqrt(np.asarray(u_masked, float)**2 + np.asarray(v_masked, float)**2)
    speed = np.where(np.isfinite(speed), speed, np.nan)

    # prune skeleton
    pruned_skel, kept_edges, all_edges = prune_skeleton_by_leaf_percentile(
        ridge_skel.astype(bool), dist, speed, leaf_percentile=leaf_percentile
    )

    # NA select
    selected_edges, scored_selected, selected_mask = score_and_filter_edges_by_bbox(
        kept_edges, Lon, Lat,
        bbox=na_bbox,
        top_k=top_k,
        min_inside_frac=min_inside_frac,
        use_midpoint=True,
        weight="length",
        speed_map=speed,
        dist_map=dist,
        return_mask=True,
        mask_shape=pruned_skel.shape
    )

    # # plot row of 3
    # fig = plt.figure(figsize=(24, 7))
    # gs = fig.add_gridspec(1, 3, wspace=0.10)

    # ax0 = fig.add_subplot(gs[0, 0], projection=ccrs.PlateCarree())
    # ax1 = fig.add_subplot(gs[0, 1], projection=ccrs.PlateCarree())
    # ax2 = fig.add_subplot(gs[0, 2], projection=ccrs.PlateCarree())

    # # Panel 1: quiver
    # ax0.set_extent(QUIVER_AX_EXTENT_SMALL, crs=ccrs.PlateCarree())
    # ax0.coastlines(linewidth=1)
    # plot_wind_quiver_single_uv(
    #     u_masked, v_masked, lats, lons,
    #     time=timeStr,
    #     stride=QUIVER_STRIDE,
    #     extent=QUIVER_EXTENT_GLOBAL,
    #     ax=ax0,
    #     storm_df=storm_df,
    #     title=f"{timeStr} (>= {pct}th pct, thr={thr:.2f} m/s)",
    #     show_quiver=True,
    # )

    # # shared distance plot
    # dist_plot = np.where(jet_mask, dist, np.nan)

    # # Panel 2: pruned skeleton
    # ax1.set_extent(QUIVER_EXTENT_GLOBAL, crs=ccrs.PlateCarree())
    # ax1.coastlines(linewidth=1)
    # im1 = ax1.pcolormesh(Lon, Lat, dist_plot, transform=ccrs.PlateCarree(), shading="auto")
    # cb1 = plt.colorbar(im1, ax=ax1, shrink=0.7, pad=0.02)
    # cb1.set_label("distance to boundary (px)")
    # yy, xx = np.where(pruned_skel)
    # ax1.scatter(Lon[yy, xx], Lat[yy, xx], s=1, transform=ccrs.PlateCarree(), color="red")
    # ax1.set_title(f"{timeStr}\npruned skeleton (leaf_percentile={leaf_percentile})")

    # # Panel 3: NA-selected edges + bbox
    # ax2.set_extent(QUIVER_EXTENT_GLOBAL, crs=ccrs.PlateCarree())
    # ax2.coastlines(linewidth=1)
    # im2 = ax2.pcolormesh(Lon, Lat, dist_plot, transform=ccrs.PlateCarree(), shading="auto")
    # cb2 = plt.colorbar(im2, ax=ax2, shrink=0.7, pad=0.02)
    # cb2.set_label("distance to boundary (px)")
    # yy2, xx2 = np.where(selected_mask)
    # ax2.scatter(Lon[yy2, xx2], Lat[yy2, xx2], s=2, transform=ccrs.PlateCarree(), color="red")

    # lon_min, lon_max, lat_min, lat_max = na_bbox
    # bbox_lons = [lon_min, lon_max, lon_max, lon_min, lon_min]
    # bbox_lats = [lat_min, lat_min, lat_max, lat_max, lat_min]
    # ax2.plot(bbox_lons, bbox_lats, transform=ccrs.PlateCarree(), linewidth=2)
    # ax2.set_title(f"{timeStr}\nNA-selected edges (top_k={top_k}, min_frac={min_inside_frac})")

    # plt.show()
    # plt.close(fig)

    # return {
    #     "time": timeStr,
    #     "thr": float(thr),
    #     "n_edges_all": len(all_edges),
    #     "n_edges_kept": len(kept_edges),
    #     "n_edges_selected": len(selected_edges),
    #     "scored_selected": scored_selected,
    # }
    # --- EDIT run_one_time_and_plot(): replace the PLOTTING block with JSON packaging ---
    
    # Right after you compute selected_edges / selected_mask, add:
    lines = []
    for e in selected_edges:
        line = edge_pixels_to_latlon_line(e, Lat, Lon)
        if len(line) >= 2:
            lines.append(line)

    # Return lines instead of plotting
    return {
        "time": timeStr,
        "lines": lines,
        # optional extras if you want debugging:
        # "thr": float(thr),
        # "n_edges_all": len(all_edges),
        # "n_edges_kept": len(kept_edges),
        # "n_edges_selected": len(selected_edges),
    }



# =========================
# Main
# =========================
def main():
    # load datasets
    subsetLevelsDs = xr.open_zarr(SUBSET_LEVELS_FILE, consolidated=False)

    # load storm coords
    sandyCoords = pd.read_csv(SANDY_COORDS_FILE)
    sandyCoords["datetime"] = pd.to_datetime(sandyCoords["datetime"])
    sandyCoords = sandyCoords.sort_values("datetime").reset_index(drop=True)
    sandyCoords["lat"] = sandyCoords["lat"].astype(float)
    sandyCoords["lon"] = sandyCoords["lon"].astype(float)

    # time loop
    times = pd.date_range(start=START_TIME, end=END_TIME, freq=FREQ)

    summary = []
    out_dict = {}
    
    for t in times:
        timeStr = t.strftime("%Y-%m-%dT%H:%M:%S")
        out = run_one_time_and_plot(subsetLevelsDs, sandyCoords, timeStr)
        # summary.append(out)
        out_dict[timeStr] = {"lines": out["lines"]}

    with open(OUTPUT_JSON, "w") as f:
        json.dump(out_dict, f)

    print(f"Wrote {len(out_dict)} timesteps to: {OUTPUT_JSON}")

    # optional: print a tiny summary at end
    # print("\nDone. Summary (first 5):")
    # for row in summary[:5]:
    #     print(row)


if __name__ == "__main__":
    main()
