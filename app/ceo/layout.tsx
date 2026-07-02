import Sidebar from "@/components/layout/Sidebar";

export default function CeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-56 min-h-screen overflow-y-auto scrollbar-thin">
        {children}
      </main>
    </div>
  );
}
