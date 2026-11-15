"use client";

import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states/states";
import { PageHead, Panel } from "@/components/admin/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdmin } from "@/hooks/use-admin";
import type { AdminData } from "@/lib/data/types";
import { cn } from "@/lib/utils";

type Key = AdminData["keys"][number];

export default function Keys() {
  const a = useAdmin();
  const [edited, setKeys] = useState<Key[] | null>(null);
  const keys = edited ?? (a.status === "ready" ? a.data.keys : null);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<Key | null>(null);
  if (a.status === "error") return <ErrorState title="API keys didn't load" error={a.error} onRetry={a.reload} />;

  return (
    <>
      <PageHead title="API keys" body="Keys the Council uses to call model providers. Only the last four characters are ever shown." action={<Button onClick={() => setAdding(true)}><Plus /> Add key</Button>} />
      <Panel>
        {!keys ? <div className="p-4"><ListSkeleton rows={4} /></div> : keys.length === 0 ? <EmptyState icon={KeyRound} title="No keys yet" body="Add a provider key so the Council can run." action={<Button onClick={() => setAdding(true)}>Add key</Button>} /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-3 font-medium">Provider</th><th className="px-4 py-3 font-medium">Key</th><th className="px-4 py-3 font-medium">Added</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium text-ink">{k.provider}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-2">••••{k.last4}</td>
                <td className="px-4 py-3 text-ink-3">{k.created}</td>
                <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", k.status === "active" ? "bg-success/15 text-success" : "bg-raised text-ink-3")}>{k.status === "active" ? "Active" : "Revoked"}</span></td>
                <td className="px-4 py-3 text-right">{k.status === "active" && <Button variant="ghost" size="sm" onClick={() => setRevoking(k)}>Revoke</Button>}</td>
              </tr>))}</tbody></table></div>
        )}
      </Panel>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const secret = String(f.get("key") ?? ""); if (secret.length < 8) return toast.error("That key looks too short."); setKeys([{ id: `k${Date.now()}`, provider: String(f.get("provider")), last4: secret.slice(-4), created: "Today", status: "active" }, ...(keys ?? [])]); setAdding(false); toast.success("Key added"); }}>
            <DialogHeader><DialogTitle>Add an API key</DialogTitle><DialogDescription>This preview keeps the key in memory only and shows the last four characters.</DialogDescription></DialogHeader>
            <div className="my-4 space-y-4">
              <div className="space-y-1.5"><Label htmlFor="provider">Provider</Label><select id="provider" name="provider" className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"><option>Anthropic</option><option>OpenAI</option><option>Google</option></select></div>
              <div className="space-y-1.5"><Label htmlFor="key">Key</Label><Input id="key" name="key" type="password" autoComplete="off" required placeholder="Paste the key" /></div>
            </div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit">Add key</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revoke this key?</DialogTitle><DialogDescription>{revoking?.provider} key ending {revoking?.last4} stops working right away. Council runs that use it will fall back to another provider.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="ghost" onClick={() => setRevoking(null)}>Keep key</Button><Button variant="destructive" onClick={() => { setKeys((keys ?? []).map((x) => (x.id === revoking?.id ? { ...x, status: "revoked" } : x))); setRevoking(null); toast.success("Key revoked"); }}>Revoke key</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
