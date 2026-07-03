import Topbar from "@/components/layout/Topbar";
import ShipsenKpiDashboard from "@/components/ShipsenKpiDashboard";

export default function ShipsenPage() {
  return (
    <div>
      <Topbar title="Shipsen" subtitle="Commandes confirmées et revenus par pays" />
      <div className="px-6 py-5">
        <ShipsenKpiDashboard />
      </div>
    </div>
  );
}
