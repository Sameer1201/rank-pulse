import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import SuperAdminAdmins from "@/pages/super-admin/Admins";
import SuperAdminStudents from "@/pages/super-admin/Students";

type ManagementTab = "admins" | "students";

function getTabFromPath(pathname: string): ManagementTab {
  if (pathname.includes("/students")) return "students";
  return "admins";
}

export default function SuperAdminManagement({
  initialTab,
}: {
  initialTab?: ManagementTab;
}) {
  const [location, setLocation] = useLocation();
  const pathTab = useMemo(() => getTabFromPath(location), [location]);
  const [activeTab, setActiveTab] = useState<ManagementTab>(initialTab ?? pathTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
      return;
    }

    if (location !== "/super-admin/management") {
      setActiveTab(pathTab);
    }
  }, [initialTab, location, pathTab]);

  const currentTab = activeTab;

  const openTab = (tab: ManagementTab) => {
    setActiveTab(tab);
    if (location !== "/super-admin/management") {
      setLocation("/super-admin/management");
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Management</h1>
        <p className="text-sm text-muted-foreground">
          Teachers and students are managed from one place now.
        </p>
      </div>

      <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-1.5 shadow-sm">
        <Button
          type="button"
          variant={currentTab === "admins" ? "default" : "ghost"}
          className={`rounded-xl px-4 ${currentTab === "admins" ? "" : "text-muted-foreground"}`}
          onClick={() => openTab("admins")}
        >
          <UserCheck size={15} className="mr-2" />
          Teachers
        </Button>
        <Button
          type="button"
          variant={currentTab === "students" ? "default" : "ghost"}
          className={`rounded-xl px-4 ${currentTab === "students" ? "" : "text-muted-foreground"}`}
          onClick={() => openTab("students")}
        >
          <Users size={15} className="mr-2" />
          Students
        </Button>
      </div>

      {currentTab === "admins" ? <SuperAdminAdmins /> : <SuperAdminStudents />}
    </div>
  );
}
