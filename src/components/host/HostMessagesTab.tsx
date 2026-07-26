import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
interface HostMessagesTabProps {
  hostId: string;
}
export function HostMessagesTab({
  hostId
}: HostMessagesTabProps) {
  const {
    data: messages,
    isLoading
  } = useQuery({
    queryKey: ["host-messages", hostId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("host_messages").select("*").eq("host_id", hostId).order("created_at", {
        ascending: false
      });
      if (error) throw error;
      return data;
    }
  });
  const unreadCount = messages?.filter(m => !m.is_read).length || 0;
  if (isLoading) {
    return <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>;
  }
  return <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">MESSAGES</h2>
          <p className="text-primary text-xs">Communicate With Renters</p>
        </div>
        {unreadCount > 0 && <Badge variant="destructive">{unreadCount} unread</Badge>}
      </div>

      {messages && messages.length > 0 ? <div className="space-y-2">
          {messages.map(message => <Card key={message.id} className={`cursor-pointer transition-colors hover:border-primary/50 ${!message.is_read ? 'bg-primary/5 border-primary/20' : ''}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium truncate">
                        {message.sender_id ? "Renter" : "System"}
                      </p>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(message.created_at), {
                    addSuffix: true
                  })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {message.message}
                    </p>
                  </div>
                  {!message.is_read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />}
                </div>
              </CardContent>
            </Card>)}
        </div> : <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare className="w-12 h-12 text-primary mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">NO MESSAGES YET </h3>
            <p className="text-primary text-xs">
              Messages From Renters Will Appear Here
            </p>
          </CardContent>
        </Card>}
    </div>;
}