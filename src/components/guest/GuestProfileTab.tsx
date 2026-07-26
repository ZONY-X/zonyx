import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Upload, Camera, FileCheck, AlertCircle, X } from "lucide-react";

interface Guest {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  phone: string | null;
  drivers_license_number: string | null;
  drivers_license_expiry: string | null;
  date_of_birth: string | null;
  id_photo_url: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

interface GuestProfileTabProps {
  userId: string;
  guest?: Guest | null;
  isNewGuest?: boolean;
}

export function GuestProfileTab({ userId, guest, isNewGuest = false }: GuestProfileTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const idPhotoInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    display_name: "",
    bio: "",
    phone: "",
    drivers_license_number: "",
    drivers_license_expiry: "",
    date_of_birth: "",
  });

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [idPhotoUrl, setIdPhotoUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingIdPhoto, setUploadingIdPhoto] = useState(false);
  const [idPhotoLoading, setIdPhotoLoading] = useState(true);
  const [idPhotoPreviewOpen, setIdPhotoPreviewOpen] = useState(false);

  useEffect(() => {
    if (guest) {
      setFormData({
        display_name: guest.display_name || "",
        bio: guest.bio || "",
        phone: guest.phone || "",
        drivers_license_number: guest.drivers_license_number || "",
        drivers_license_expiry: guest.drivers_license_expiry || "",
        date_of_birth: guest.date_of_birth || "",
      });
      setAvatarUrl(guest.avatar_url);
      setIdPhotoUrl(guest.id_photo_url);
    }
  }, [guest]);

  const uploadFile = async (file: File, bucket: string, path: string): Promise<string> => {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: true });
    
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: "Please upload an image file", variant: "destructive" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image must be less than 5MB", variant: "destructive" });
      return;
    }

    setUploadingAvatar(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${userId}/avatar.${fileExt}`;
      const url = await uploadFile(file, 'guest-avatars', filePath);
      setAvatarUrl(url);
      toast({ title: "Avatar uploaded successfully!" });
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast({ title: "Failed to upload avatar", variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleIdPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: "Please upload an image file", variant: "destructive" });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Image must be less than 10MB", variant: "destructive" });
      return;
    }

    setUploadingIdPhoto(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${userId}/id-photo.${fileExt}`;
      const url = await uploadFile(file, 'guest-id-photos', filePath);
      setIdPhotoUrl(url);
      toast({ title: "ID photo uploaded successfully!" });
    } catch (error) {
      console.error("ID photo upload error:", error);
      toast({ title: "Failed to upload ID photo", variant: "destructive" });
    } finally {
      setUploadingIdPhoto(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        display_name: data.display_name,
        bio: data.bio || null,
        phone: data.phone || null,
        drivers_license_number: data.drivers_license_number || null,
        drivers_license_expiry: data.drivers_license_expiry || null,
        date_of_birth: data.date_of_birth || null,
        avatar_url: avatarUrl,
        id_photo_url: idPhotoUrl,
      };

      if (isNewGuest || !guest) {
        const { error } = await supabase
          .from("guests")
          .insert({
            user_id: userId,
            ...payload,
          });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("guests")
          .update(payload)
          .eq("id", guest.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: isNewGuest ? "Profile created!" : "Profile updated!" });
      queryClient.invalidateQueries({ queryKey: ["guest", userId] });
    },
    onError: (error) => {
      console.error("Error saving profile:", error);
      toast({ title: "Failed to save profile", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.display_name.trim()) {
      toast({ title: "Display name is required", variant: "destructive" });
      return;
    }
    saveMutation.mutate(formData);
  };

  return (
    <>
      {/* ID Photo Preview Modal */}
      <Dialog open={idPhotoPreviewOpen} onOpenChange={setIdPhotoPreviewOpen}>
        <DialogContent className="max-w-3xl p-2 bg-background/95 backdrop-blur">
          <button
            onClick={() => setIdPhotoPreviewOpen(false)}
            className="absolute right-3 top-3 z-10 rounded-full bg-background/80 p-1 hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center justify-center p-4">
            <img
              src={idPhotoUrl || ""}
              alt="ID Photo Preview"
              className="max-h-[80vh] max-w-full rounded-lg object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
      {/* Avatar Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2 uppercase">
            <Camera className="h-5 w-5" />
            Profile Photo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-32 w-32 border-4 border-primary/20">
              <AvatarImage src={avatarUrl || undefined} alt="Profile" />
              <AvatarFallback className="text-4xl bg-primary/10">
                <User className="h-16 w-16 text-primary" />
              </AvatarFallback>
            </Avatar>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              {uploadingAvatar ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {avatarUrl ? "Change Photo" : "Upload Photo"}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Personal Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2 uppercase">
            <User className="h-5 w-5" />
            {isNewGuest ? "Create Your Profile" : "Personal Information"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="display_name">Full Name *</Label>
                <Input
                  id="display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder="Your full name"
                  required
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="date_of_birth">Date of Birth</Label>
                <Input
                  id="date_of_birth"
                  type="date"
                  value={formData.date_of_birth}
                  onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+1 (555) 123-4567"
                maxLength={20}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">About You</Label>
              <Textarea
                id="bio"
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                placeholder="Tell hosts a bit about yourself..."
                rows={3}
                maxLength={500}
              />
            </div>

            <Button type="submit" disabled={saveMutation.isPending} className="w-full">
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNewGuest ? "Create Profile" : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Driver's License & ID Verification */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2">
            <FileCheck className="h-5 w-5" />
            Driver's License & ID Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 border border-border rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium">Why we need this</p>
                <p className="text-sm text-muted-foreground">
                  A valid driver's license is required to rent vehicles. Your information is kept secure and private.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="drivers_license_number">Driver's License Number</Label>
                <Input
                  id="drivers_license_number"
                  value={formData.drivers_license_number}
                  onChange={(e) => setFormData({ ...formData, drivers_license_number: e.target.value })}
                  placeholder="License number"
                  maxLength={50}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="drivers_license_expiry">License Expiry Date</Label>
                <Input
                  id="drivers_license_expiry"
                  type="date"
                  value={formData.drivers_license_expiry}
                  onChange={(e) => setFormData({ ...formData, drivers_license_expiry: e.target.value })}
                />
              </div>
            </div>

            {/* ID Photo Upload */}
            <div className="space-y-3">
              <Label>ID Photo</Label>
              <div className="border-2 border-dashed border-border rounded-lg p-6">
                {idPhotoUrl ? (
                  <div className="flex flex-col items-center gap-4">
                    {idPhotoLoading && (
                      <div className="flex items-center justify-center h-40 w-48 bg-muted rounded-lg border border-border">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      </div>
                    )}
                    <img 
                      src={idPhotoUrl} 
                      alt="ID Photo" 
                      className={`max-h-80 w-auto rounded-lg object-contain border border-border bg-muted cursor-pointer hover:opacity-90 transition-opacity ${idPhotoLoading ? 'hidden' : ''}`}
                      onClick={() => setIdPhotoPreviewOpen(true)}
                      onLoad={() => setIdPhotoLoading(false)}
                      onError={(e) => {
                        setIdPhotoLoading(false);
                        const target = e.currentTarget;
                        target.onerror = null;
                        target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150' viewBox='0 0 200 150'%3E%3Crect fill='%23374151' width='200' height='150'/%3E%3Ctext x='50%25' y='45%25' font-family='system-ui' font-size='14' fill='%239CA3AF' text-anchor='middle'%3EImage failed to load%3C/text%3E%3Ctext x='50%25' y='60%25' font-family='system-ui' font-size='12' fill='%236B7280' text-anchor='middle'%3ETry re-uploading%3C/text%3E%3C/svg%3E";
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Click image to preview</p>
                    <div className="bg-primary text-primary-foreground px-3 py-1 rounded text-sm font-medium">
                      Uploaded
                    </div>
                    <input
                      ref={idPhotoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleIdPhotoUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => idPhotoInputRef.current?.click()}
                      disabled={uploadingIdPhoto}
                    >
                      {uploadingIdPhoto ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        "Replace Photo"
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="p-4 bg-muted rounded-full">
                      <Upload className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">Upload your ID photo</p>
                      <p className="text-sm text-muted-foreground">
                        Take a clear photo of your driver's license or ID card
                      </p>
                    </div>
                    <input
                      ref={idPhotoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleIdPhotoUpload}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => idPhotoInputRef.current?.click()}
                      disabled={uploadingIdPhoto}
                    >
                      {uploadingIdPhoto ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Camera className="mr-2 h-4 w-4" />
                          Select Photo
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <Button type="submit" disabled={saveMutation.isPending} className="w-full">
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Verification Info
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
