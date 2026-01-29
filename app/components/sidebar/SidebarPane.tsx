import ControlsHelp from "./ControlsHelp";
import HurricaneTrackExplainerCard from "./HurricaneTrackExplainerCard";

export default function SidebarPane() {
  return (
    <aside
      style={{
        position: "relative",
        top: 0,
        right: 0,
        height: "100vh",
        // width: 320,
        display: "flex",
        flexDirection: "column",
        backdropFilter: "blur(6px)",
        background: "rgba(18,18,20,0.55)",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        zIndex: 1000,
        overflow: "hidden",
      }}
    >
      <HurricaneTrackExplainerCard />

      <ControlsHelp />
    </aside>
  );
}