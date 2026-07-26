import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface GuestMessagesTabProps {
  guestId: string;
}

export function GuestMessagesTab({ guestId }: GuestMessagesTabProps) {
  const { data: messages, isLoading } = useQuery({
    queryKey: ["guest-messages", guestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guest_messages")
        .select("*")
        .eq("guest_id", guestId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching messages:", error);
        return [];
      }
      return data;
    },
    enabled: !!guestId,
  });

  const unreadCount = messages?.filter(m => !m.is_read).length || 0;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Messages</h3>
        {unreadCount > 0 && (
          <Badge variant="destructive">{unreadCount} unread</Badge>
        )}
      </div>

      {(!messages || messages.length === 0) ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No messages yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {messages.map((message) => (
            <Card 
              key={message.id} 
              className={`cursor-pointer hover:border-primary transition-colors ${
                !message.is_read ? "border-l-4 border-l-primary" : ""
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">
                        Host
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {message.message}
                    </p>
                  </div>
                  {!message.is_read && (
                    <div className="w-2 h-2 bg-primary rounded-full mt-2" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
