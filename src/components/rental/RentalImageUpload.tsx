import { ImageUploadDropzone } from "./ImageUploadDropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface RentalImageUploadProps {
  showBefore?: boolean;
  showAfter?: boolean;
  userRole: "guest" | "host";
}

export function RentalImageUpload({ showBefore = true, showAfter = true, userRole }: RentalImageUploadProps) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl uppercase text-center">VEHICLE CONDITION PHOTOS</CardTitle>
        <CardDescription className="text-center">
          Upload photos documenting the vehicle's condition before and after your rental
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {showBefore && (
          <ImageUploadDropzone
            type="before"
            userRole={userRole}
          />
        )}
        {showAfter && (
          <ImageUploadDropzone
            type="after"
            userRole={userRole}
          />
        )}
      </CardContent>
    </Card>
  );
}
