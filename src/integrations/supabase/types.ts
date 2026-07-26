export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          email: string
          id: string
          name: string
          status: string
          submitted_at: string
        }
        Insert: {
          email: string
          id?: string
          name: string
          status?: string
          submitted_at?: string
        }
        Update: {
          email?: string
          id?: string
          name?: string
          status?: string
          submitted_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          created_at: string
          dropoff_location: string | null
          dropoff_time: string | null
          end_date: string
          guest_id: string | null
          host_id: string
          id: string
          pickup_location: string | null
          pickup_time: string | null
          renter_id: string | null
          start_date: string
          status: string | null
          total_price: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          dropoff_location?: string | null
          dropoff_time?: string | null
          end_date: string
          guest_id?: string | null
          host_id: string
          id?: string
          pickup_location?: string | null
          pickup_time?: string | null
          renter_id?: string | null
          start_date: string
          status?: string | null
          total_price: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          dropoff_location?: string | null
          dropoff_time?: string | null
          end_date?: string
          guest_id?: string | null
          host_id?: string
          id?: string
          pickup_location?: string | null
          pickup_time?: string | null
          renter_id?: string | null
          start_date?: string
          status?: string | null
          total_price?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_messages: {
        Row: {
          booking_id: string | null
          created_at: string
          guest_id: string
          id: string
          is_read: boolean | null
          message: string
          sender_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          guest_id: string
          id?: string
          is_read?: boolean | null
          message: string
          sender_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          guest_id?: string
          id?: string
          is_read?: boolean | null
          message?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_messages_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_messages_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests_public"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          date_of_birth: string | null
          display_name: string
          drivers_license_expiry: string | null
          drivers_license_number: string | null
          id: string
          id_photo_url: string | null
          is_verified: boolean
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name: string
          drivers_license_expiry?: string | null
          drivers_license_number?: string | null
          id?: string
          id_photo_url?: string | null
          is_verified?: boolean
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string
          drivers_license_expiry?: string | null
          drivers_license_number?: string | null
          id?: string
          id_photo_url?: string | null
          is_verified?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      host_locations: {
        Row: {
          created_at: string
          custom_locations: Json | null
          delivery_enabled: boolean | null
          delivery_fee_per_mile: number | null
          delivery_radius_miles: number | null
          home_address: string | null
          home_city: string | null
          home_latitude: number | null
          home_longitude: number | null
          home_state: string | null
          home_zip: string | null
          host_id: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_locations?: Json | null
          delivery_enabled?: boolean | null
          delivery_fee_per_mile?: number | null
          delivery_radius_miles?: number | null
          home_address?: string | null
          home_city?: string | null
          home_latitude?: number | null
          home_longitude?: number | null
          home_state?: string | null
          home_zip?: string | null
          host_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_locations?: Json | null
          delivery_enabled?: boolean | null
          delivery_fee_per_mile?: number | null
          delivery_radius_miles?: number | null
          home_address?: string | null
          home_city?: string | null
          home_latitude?: number | null
          home_longitude?: number | null
          home_state?: string | null
          home_zip?: string | null
          host_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "host_locations_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: true
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_locations_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: true
            referencedRelation: "hosts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      host_messages: {
        Row: {
          booking_id: string | null
          created_at: string
          host_id: string
          id: string
          is_read: boolean | null
          message: string
          sender_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          host_id: string
          id?: string
          is_read?: boolean | null
          message: string
          sender_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          host_id?: string
          id?: string
          is_read?: boolean | null
          message?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "host_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_messages_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_messages_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts_public"
            referencedColumns: ["id"]
          },
        ]
      }
      hosts: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          host_name: string
          id: string
          is_approved: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          host_name: string
          id?: string
          is_approved?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          host_name?: string
          id?: string
          is_approved?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          rater_id: string
          rating: number
          review: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          rater_id: string
          rating: number
          review?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          rater_id?: string
          rating?: number
          review?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_images: {
        Row: {
          id: string
          image_type: string
          image_url: string
          notes: string | null
          rental_id: string | null
          uploaded_at: string
          user_id: string | null
        }
        Insert: {
          id?: string
          image_type: string
          image_url: string
          notes?: string | null
          rental_id?: string | null
          uploaded_at?: string
          user_id?: string | null
        }
        Update: {
          id?: string
          image_type?: string
          image_url?: string
          notes?: string | null
          rental_id?: string | null
          uploaded_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      vehicle_documents: {
        Row: {
          created_at: string
          drivers_license_expiry: string | null
          drivers_license_number: string | null
          id: string
          insurance_document_url: string | null
          insurance_expiry: string | null
          insurance_policy_number: string | null
          insurance_provider: string | null
          ownership_document_url: string | null
          plate_number: string | null
          registration_document_url: string | null
          registration_number: string | null
          updated_at: string
          vehicle_id: string
          vin_number: string | null
        }
        Insert: {
          created_at?: string
          drivers_license_expiry?: string | null
          drivers_license_number?: string | null
          id?: string
          insurance_document_url?: string | null
          insurance_expiry?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          ownership_document_url?: string | null
          plate_number?: string | null
          registration_document_url?: string | null
          registration_number?: string | null
          updated_at?: string
          vehicle_id: string
          vin_number?: string | null
        }
        Update: {
          created_at?: string
          drivers_license_expiry?: string | null
          drivers_license_number?: string | null
          id?: string
          insurance_document_url?: string | null
          insurance_expiry?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          ownership_document_url?: string | null
          plate_number?: string | null
          registration_document_url?: string | null
          registration_number?: string | null
          updated_at?: string
          vehicle_id?: string
          vin_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_pricing: {
        Row: {
          created_at: string
          date: string
          id: string
          is_available: boolean | null
          price: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          is_available?: boolean | null
          price: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          is_available?: boolean | null
          price?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_pricing_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          brand: string
          category: string
          created_at: string
          description: string | null
          features: string[] | null
          fuel_type: string
          host_id: string
          id: string
          image_url: string
          images: string[] | null
          is_available: boolean
          name: string
          price_per_day: number
          seats: number
          transmission: string
          updated_at: string
        }
        Insert: {
          brand: string
          category: string
          created_at?: string
          description?: string | null
          features?: string[] | null
          fuel_type?: string
          host_id: string
          id?: string
          image_url: string
          images?: string[] | null
          is_available?: boolean
          name: string
          price_per_day: number
          seats?: number
          transmission?: string
          updated_at?: string
        }
        Update: {
          brand?: string
          category?: string
          created_at?: string
          description?: string | null
          features?: string[] | null
          fuel_type?: string
          host_id?: string
          id?: string
          image_url?: string
          images?: string[] | null
          is_available?: boolean
          name?: string
          price_per_day?: number
          seats?: number
          transmission?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "hosts_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      guests_public: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
      hosts_public: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          host_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          host_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          host_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_booking: {
        Args: {
          _dropoff_location?: string
          _end_date: string
          _pickup_location?: string
          _start_date: string
          _vehicle_id: string
        }
        Returns: string
      }
      get_guest_id: { Args: { _user_id: string }; Returns: string }
      get_host_id: { Args: { _user_id: string }; Returns: string }
      is_guest: { Args: { _user_id: string }; Returns: boolean }
      is_host: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
