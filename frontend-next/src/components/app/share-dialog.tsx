"use client";

import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { MembersPanel } from "@/components/app/members-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCurrentWorkspace } from "@/hooks/use-workspace";
import { useUi } from "@/stores/ui";

export function ShareDialog() {
  const open = useUi((s) => s.shareOpen);
  const setOpen = useUi((s) => s.setShareOpen);
  const { current } = useCurrentWorkspace();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {current?.name ?? "this workspace"}</DialogTitle>
          <DialogDescription>People you add can open every doc and sheet here, based on their role. They need a Coedit account first.</DialogDescription>
        </DialogHeader>
        {current ? <MembersPanel workspaceId={current.id} myRole={current.role} /> : <p className="text-sm text-ink-3">Create a workspace first.</p>}
        <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(location.href); toast.success("Link copied"); }}><Link2 /> Copy link to this page</Button>
      </DialogContent>
    </Dialog>
  );
}
