import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Tag, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PromoCodeRow {
  id: string;
  code: string;
  discount_type: string;
  discount_value_cents: number | null;
  discount_percent: number | null;
  is_active: boolean;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
}

function formatDiscount(row: PromoCodeRow) {
  return row.discount_type === "percentage"
    ? `${Number(row.discount_percent).toFixed(0)}%`
    : `$${(Number(row.discount_value_cents || 0) / 100).toFixed(2)}`;
}

export function PromoCodesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PromoCodeRow | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    discountType: "fixed" as "fixed" | "percentage",
    discountValue: "",
    isActive: true,
    expiresAt: "",
    maxUses: "",
  });

  const { data: promoCodes, isLoading } = useQuery({
    queryKey: ["admin-promo-codes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("id, code, discount_type, discount_value_cents, discount_percent, is_active, expires_at, max_uses, uses_count")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PromoCodeRow[];
    },
  });

  const resetForm = () => {
    setFormData({ code: "", discountType: "fixed", discountValue: "", isActive: true, expiresAt: "", maxUses: "" });
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const discountValueNumber = Number(data.discountValue);
      const { error } = await supabase.from("promo_codes").insert({
        code: data.code.trim().toUpperCase(),
        discount_type: data.discountType,
        discount_value_cents: data.discountType === "fixed" ? Math.round(discountValueNumber * 100) : null,
        discount_percent: data.discountType === "percentage" ? discountValueNumber : null,
        is_active: data.isActive,
        expires_at: data.expiresAt ? new Date(data.expiresAt).toISOString() : null,
        max_uses: data.maxUses ? Number(data.maxUses) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Promo code created." });
      resetForm();
      setShowCreateDialog(false);
      queryClient.invalidateQueries({ queryKey: ["admin-promo-codes"] });
    },
    onError: (error) => {
      toast({ title: "Unable to create promo code", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from("promo_codes").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
    onError: (error) => toast({ title: "Unable to update promo code", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("promo_codes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Promo code deleted." });
      queryClient.invalidateQueries({ queryKey: ["admin-promo-codes"] });
    },
    onError: (error) => toast({ title: "Unable to delete promo code", description: error.message, variant: "destructive" }),
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.code.trim() || !formData.discountValue) {
      toast({ title: "Enter a code and discount value", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold uppercase text-primary">Promo Codes</h2>
          <p className="text-muted-foreground text-sm">Admin-only discount code management</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Promo Code
        </Button>
      </div>

      {promoCodes && promoCodes.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promoCodes.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.code}</TableCell>
                    <TableCell>{formatDiscount(row)}</TableCell>
                    <TableCell>{row.uses_count}{row.max_uses != null ? ` / ${row.max_uses}` : ""}</TableCell>
                    <TableCell>{row.expires_at ? new Date(row.expires_at).toLocaleDateString() : "Never"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={row.is_active}
                          onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: row.id, isActive: checked })}
                        />
                        <Badge variant={row.is_active ? "default" : "secondary"}>{row.is_active ? "Active" : "Disabled"}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="ghost" size="icon" onClick={() => setDeleteTarget(row)} aria-label={`Delete promo code ${row.code}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Tag className="w-12 h-12 text-primary mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No promo codes yet</h3>
            <p className="text-primary text-xs">Create one to offer discounted checkout links</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Promo Code</DialogTitle>
            <DialogDescription>Discounts are always validated and recalculated server-side at checkout.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="promo-code">Code *</Label>
              <Input
                id="promo-code"
                value={formData.code}
                onChange={(event) => setFormData({ ...formData, code: event.target.value.toUpperCase() })}
                placeholder="e.g. WELCOME400"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="promo-discount-type">Discount type</Label>
                <Select
                  value={formData.discountType}
                  onValueChange={(value: "fixed" | "percentage") => setFormData({ ...formData, discountType: value })}
                >
                  <SelectTrigger id="promo-discount-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed amount ($)</SelectItem>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="promo-discount-value">
                  {formData.discountType === "fixed" ? "Discount amount ($) *" : "Discount percent (%) *"}
                </Label>
                <Input
                  id="promo-discount-value"
                  type="number"
                  step="0.01"
                  min="0"
                  max={formData.discountType === "percentage" ? "100" : undefined}
                  value={formData.discountValue}
                  onChange={(event) => setFormData({ ...formData, discountValue: event.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="promo-expires">Expiration date (optional)</Label>
                <Input
                  id="promo-expires"
                  type="date"
                  value={formData.expiresAt}
                  onChange={(event) => setFormData({ ...formData, expiresAt: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="promo-max-uses">Max uses (optional)</Label>
                <Input
                  id="promo-max-uses"
                  type="number"
                  min="1"
                  value={formData.maxUses}
                  onChange={(event) => setFormData({ ...formData, maxUses: event.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label htmlFor="promo-active">Active immediately</Label>
              <Switch id="promo-active" checked={formData.isActive} onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })} />
            </div>
            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Promo Code"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete promo code {deleteTarget?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the code. It will no longer apply to new checkouts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return;
                deleteMutation.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
