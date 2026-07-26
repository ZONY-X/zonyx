import { useState, useCallback, useEffect } from "react";
import { Upload, X, LogIn, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface UploadedImage {
  id: string;
  url: string;
  storagePath: string;
  bucket: string;
}

const LEGACY_BUCKETS = ["rental-images", "guest-rental-images", "host-rental-images"] as const;

async function createSignedUrlFromBuckets(
  buckets: string[],
  filePath: string,
  expiresInSeconds = 3600
): Promise<{ signedUrl: string; bucket: string } | null> {
  for (const bucket of buckets) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresInSeconds);
    if (!error && data?.signedUrl) {
      return { signedUrl: data.signedUrl, bucket };
    }
  }
  return null;
}

interface ImageUploadDropzoneProps {
  type: "before" | "after";
  userRole: "guest" | "host";
  onUploadComplete?: (url: string) => void;
}

export function ImageUploadDropzone({
  type,
  userRole,
  onUploadComplete
}: ImageUploadDropzoneProps) {
  // Determine which bucket to use based on user role AND photo type
  // Format: {role}-{type}-photos (e.g., guest-before-photos, host-after-photos)
  const bucketName = `${userRole}-${type}-photos`;
  const candidateBuckets = [
    bucketName,
    `${userRole}-rental-images`,
    ...LEGACY_BUCKETS,
  ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  // Fetch existing images on mount
  useEffect(() => {
    const fetchExistingImages = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        // Fetch image records from database
        const { data: imageRecords, error: fetchError } = await supabase
          .from("rental_images")
          .select("id, image_url, uploaded_at")
          .eq("user_id", user.id)
          .eq("image_type", type)
          .order("uploaded_at", { ascending: false });

        if (fetchError) throw fetchError;

        if (imageRecords && imageRecords.length > 0) {
          // Generate signed URLs for each image
          const imagesWithUrls = await Promise.all(
            imageRecords.map(async (record) => {
              // Backwards compatible: older uploads may still be in legacy buckets.
              // Try the current bucket first, then role-split buckets, then the original legacy bucket.
              if (record.image_url.startsWith("http://") || record.image_url.startsWith("https://")) {
                return {
                  id: record.id,
                  url: record.image_url,
                  storagePath: record.image_url,
                  bucket: "",
                };
              }

              const signed = await createSignedUrlFromBuckets(candidateBuckets, record.image_url, 3600);
              return {
                id: record.id,
                url: signed?.signedUrl || "",
                storagePath: record.image_url,
                bucket: signed?.bucket || "",
              };
            })
          );

          setUploadedImages(imagesWithUrls.filter(img => img.url));
        }
      } catch (err) {
        setError("Couldn't load your existing photos. Please make sure you're signed into the same account used to upload them.");
        if (import.meta.env.DEV) {
          console.error("Error fetching existing images:", err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchExistingImages();
  }, [user, type, bucketName]);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);
  const uploadFile = async (file: File) => {
    if (!user) {
      setError("Please sign in to upload images");
      return;
    }

    // Client-side validation (server also enforces these)
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setError("Please upload JPEG, PNG, WebP, or GIF images only");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("File size must be less than 5MB");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fileExt = file.name.split(".").pop()?.toLowerCase();
      const fileName = `${type}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      // Path-based access control: user_id/type/filename
      const filePath = `${user.id}/${type}/${fileName}`;
      const {
        error: uploadError
      } = await supabase.storage.from(bucketName).upload(filePath, file);
      if (uploadError) throw uploadError;

      // Create signed URL for private bucket
      const {
        data: signedUrlData,
        error: signedUrlError
      } = await supabase.storage.from(bucketName).createSignedUrl(filePath, 3600); // 1 hour expiration

      if (signedUrlError) throw signedUrlError;
      const signedUrl = signedUrlData.signedUrl;

      // Save to database with user_id and get the ID back
      const { data: insertData, error: insertError } = await supabase
        .from("rental_images")
        .insert({
          image_type: type,
          image_url: filePath,
          user_id: user.id
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      setUploadedImages(prev => [...prev, {
        id: insertData.id,
        url: signedUrl,
        storagePath: filePath,
        bucket: bucketName
      }]);

      onUploadComplete?.(signedUrl);
    } catch (err) {
      // Don't log upload errors to console in production to avoid exposing storage details
      if (import.meta.env.DEV) {
        console.error("Upload error:", err);
      }
      setError("Failed to upload image. Please try again.");
    } finally {
      setUploading(false);
    }
  };
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  }, [user, type]);
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(uploadFile);
  };
  const removeImage = async (imageToRemove: UploadedImage) => {
    try {
      // Delete from storage
      const bucketToUse = imageToRemove.bucket || bucketName;
      await supabase.storage.from(bucketToUse).remove([imageToRemove.storagePath]);
      
      // Delete from database
      await supabase.from("rental_images").delete().eq("id", imageToRemove.id);
      
      // Update local state
      setUploadedImages(prev => prev.filter(img => img.id !== imageToRemove.id));
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error("Error removing image:", err);
      }
      setError("Failed to remove image. Please try again.");
    }
  };

  // Show sign-in prompt if not authenticated
  if (!user) {
    return <div className="space-y-4">
        <label className="block text-sm font-medium text-foreground capitalize">
          {type} Photos
        </label>
        <div className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center border-muted-foreground/25">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 bg-muted text-muted-foreground">
            <LogIn className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-foreground mb-2">
            Sign in to upload photos
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            You need to be signed in to upload vehicle condition photos
          </p>
          <Button asChild size="sm">
            <Link to="/auth">Sign In</Link>
          </Button>
        </div>
      </div>;
  }
  return <div className="space-y-4">
      <label className="block font-medium uppercase text-primary text-xl font-sans text-center">
        {type} PHOTOS
      </label>
      
      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={cn("relative border-2 border-dashed rounded-xl p-8 transition-all duration-200 cursor-pointer", "flex flex-col items-center justify-center text-center", isDragOver ? "border-primary bg-primary/5 scale-[1.02]" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50", uploading && "opacity-50 pointer-events-none")}>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={uploading} />
        
        <div className={cn("w-12 h-12 rounded-full flex items-center justify-center mb-4 transition-colors", isDragOver ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          <Upload className="w-6 h-6" />
        </div>
        
        <p className="text-sm font-medium text-foreground mb-1">
          {uploading ? "Uploading..." : "DROP IMAGES HERE or CLICK TO BROWSE"}
        </p>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP, GIF up to 5MB each
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : uploadedImages.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          {uploadedImages.map((image) => (
            <div key={image.id} className="relative group aspect-square rounded-lg overflow-hidden bg-muted">
              <img src={image.url} alt={`${type} photo`} className="w-full h-full object-cover" />
              <button 
                onClick={() => removeImage(image)} 
                className="absolute top-2 right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          No {type} photos uploaded on this account yet.
        </p>
      )}
    </div>;
}