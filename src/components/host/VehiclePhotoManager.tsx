import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BUCKET = "vehicle-images";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function uniqueImages(imageUrl: string | null, images: string[] | null) {
  return Array.from(new Set([imageUrl, ...(images ?? [])].filter((value): value is string => Boolean(value))));
}

function storagePathFromUrl(url: string) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  try {
    const parsed = new URL(url);
    const index = parsed.pathname.indexOf(marker);
    return index >= 0 ? decodeURIComponent(parsed.pathname.slice(index + marker.length)) : null;
  } catch {
    return null;
  }
}

function extensionFor(file: File) {
  const byType: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  return byType[file.type] ?? "jpg";
}

interface VehiclePhotoManagerProps {
  vehicle: {
    id: string;
    host_profile_id: string;
    brand: string;
    name: string;
    image_url: string | null;
    images: string[] | null;
  };
  onChange: (images: string[]) => void;
}

export function VehiclePhotoManager({ vehicle, onChange }: VehiclePhotoManagerProps) {
  const { toast } = useToast();
  const uploadInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState(() => uniqueImages(vehicle.image_url, vehicle.images));
  const [busy, setBusy] = useState(false);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);

  const persist = async (next: string[]) => {
    const { data, error } = await supabase
      .from("vehicles")
      .update({ image_url: next[0] ?? null, images: next })
      .eq("id", vehicle.id)
      .select("id")
      .single();
    if (error) throw error;
    if (!data) throw new Error("Vehicle photo access was not authorized.");
    setPhotos(next);
    onChange(next);
  };

  const uploadFile = async (file: File) => {
    if (!ACCEPTED_TYPES.has(file.type)) throw new Error("Use a JPEG, PNG, WebP, or GIF image.");
    if (file.size > MAX_FILE_SIZE) throw new Error("Each photo must be 10 MB or smaller.");
    const path = `${vehicle.host_profile_id}/${vehicle.id}/${Date.now()}-${crypto.randomUUID()}.${extensionFor(file)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    return { path, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const uploaded: { path: string; url: string }[] = [];
    try {
      for (const file of Array.from(files)) uploaded.push(await uploadFile(file));
      await persist([...photos, ...uploaded.map((item) => item.url)]);
      toast({ title: uploaded.length === 1 ? "Vehicle photo uploaded" : `${uploaded.length} vehicle photos uploaded` });
    } catch (error) {
      if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded.map((item) => item.path));
      toast({ title: "Unable to upload photo", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  };

  const handleReplace = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || replaceIndex === null) return;
    setBusy(true);
    let uploaded: { path: string; url: string } | null = null;
    try {
      uploaded = await uploadFile(file);
      const previous = photos[replaceIndex];
      const next = photos.map((photo, index) => index === replaceIndex ? uploaded!.url : photo);
      await persist(next);
      const oldPath = storagePathFromUrl(previous);
      if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);
      toast({ title: "Vehicle photo replaced" });
    } catch (error) {
      if (uploaded) await supabase.storage.from(BUCKET).remove([uploaded.path]);
      toast({ title: "Unable to replace photo", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
      setReplaceIndex(null);
      if (replaceInput.current) replaceInput.current.value = "";
    }
  };

  const updateOrder = async (next: string[], message: string) => {
    setBusy(true);
    try {
      await persist(next);
      toast({ title: message });
    } catch (error) {
      toast({ title: "Unable to update photos", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (index: number) => {
    const photo = photos[index];
    const next = photos.filter((_, photoIndex) => photoIndex !== index);
    setBusy(true);
    try {
      await persist(next);
      const path = storagePathFromUrl(photo);
      if (path) await supabase.storage.from(BUCKET).remove([path]);
      toast({ title: "Vehicle photo deleted" });
    } catch (error) {
      toast({ title: "Unable to delete photo", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    void updateOrder(next, "Vehicle photo order updated");
  };

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Vehicle photos</h3>
          <p className="text-xs text-muted-foreground">The first photo is the cover shown across ZONYX.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => uploadInput.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
          Add photos
        </Button>
        <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(event) => void handleUpload(event.target.files)} />
        <input ref={replaceInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => void handleReplace(event.target.files)} />
      </div>

      {photos.length === 0 ? (
        <button type="button" disabled={busy} onClick={() => uploadInput.current?.click()} className="flex w-full flex-col items-center justify-center gap-2 border border-dashed border-border p-8 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
          <Upload className="h-6 w-6 text-primary" />
          Upload the first vehicle photo
        </button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {photos.map((photo, index) => (
            <div key={`${photo}-${index}`} className="overflow-hidden border border-border bg-background/70">
              <div className="relative aspect-[4/3] bg-muted">
                <img src={photo} alt={`${vehicle.brand} ${vehicle.name} photo ${index + 1}`} className="h-full w-full object-cover" />
                {index === 0 && <span className="absolute left-2 top-2 flex items-center gap-1 bg-background/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary"><Star className="h-3 w-3" /> Cover</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1 p-2">
                {index !== 0 && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void updateOrder([photo, ...photos.filter((_, i) => i !== index)], "Cover photo updated")}><Star /> Set cover</Button>}
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Move photo left" disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowLeft /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Move photo right" disabled={busy || index === photos.length - 1} onClick={() => move(index, 1)}><ArrowRight /></Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setReplaceIndex(index); replaceInput.current?.click(); }}><Upload /> Replace</Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete photo" disabled={busy} onClick={() => void removePhoto(index)} className="ml-auto text-destructive hover:text-destructive"><Trash2 /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}