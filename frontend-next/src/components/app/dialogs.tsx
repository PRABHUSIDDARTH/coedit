"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NameDialog({ title, label, initial = "", confirm, onSubmit, onClose }: { title: string; label: string; initial?: string; confirm: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <div className="my-4 space-y-1.5"><Label htmlFor="name-dialog">{label}</Label><Input id="name-dialog" autoFocus value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} onFocus={(e) => e.currentTarget.select()} /></div>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!value.trim()}>{confirm}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({ title, body, confirm, onConfirm, onClose }: { title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{body}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Keep it</Button><Button variant="destructive" onClick={onConfirm}>{confirm}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
