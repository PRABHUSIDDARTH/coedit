"use client";

import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/states/states";
import { useRepo } from "@/hooks/use-repo";
import { useUi } from "@/stores/ui";

export function ShareDialog() {
  const open = useUi((s) => s.shareOpen);
  const setOpen = useUi((s) => s.setShareOpen);
  const members = useRepo("members", (r) => r.listMembers());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this workspace</DialogTitle>
          <DialogDescription>People you invite can open every doc, sheet and canvas, based on their role.</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); toast.success("Invite sent"); e.currentTarget.reset(); }}>
          <Input name="email" type="email" required placeholder="name@company.com" aria-label="Email address" />
          <Button type="submit">Send invite</Button>
        </form>
        <ul className="space-y-1" aria-label="Members">
          {members.status === "loading" && <ListSkeleton rows={3} />}
          {members.status === "error" && <li className="text-sm text-danger">Members didn&apos;t load. {members.error.message}</li>}
          {members.status === "ready" && members.data.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
              <SeatAvatar name={m.name} seat={m.seat} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{m.name}</p><p className="truncate text-xs text-ink-3">{m.email}</p></div>
              <span className="text-xs text-ink-2">{m.role}</span>
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(location.href); toast.success("Link copied"); }}><Link2 /> Copy link</Button>
      </DialogContent>
    </Dialog>
  );
}
