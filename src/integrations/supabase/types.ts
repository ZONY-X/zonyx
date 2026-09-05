export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_admin: boolean
          is_host: boolean
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string
          id?: string
          is_admin?: boolean
          is_host?: boolean
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_admin?: boolean
          is_host?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          availability_status: string
          base_daily_rate_cents: number
          brand: string
          category: string
          color: string
          created_at: string
          description: string | null
          fuel_type: string
          host_profile_id: string
          id: string
          image_url: string | null
          images: string[] | null
          is_active: boolean
          name: string
          plate: string
          seats: number
          transmission: string
          updated_at: string
          vehicle_identifier: string
          vin: string
          year: number
        }
        Insert: {
          availability_status?: string
          base_daily_rate_cents: number
          brand: string
          category: string
          color: string
          created_at?: string
          description?: string | null
          fuel_type?: string
          host_profile_id: string
          id?: string
          image_url?: string | null
          images?: string[] | null
          is_active?: boolean
          name: string
          plate: string
          seats?: number
          transmission?: string
          updated_at?: string
          vehicle_identifier: string
          vin: string
          year: number
        }
        Update: {
          availability_status?: string
          base_daily_rate_cents?: number
          brand?: string
          category?: string
          color?: string
          created_at?: string
          description?: string | null
          fuel_type?: string
          host_profile_id?: string
          id?: string
          image_url?: string | null
          images?: string[] | null
          is_active?: boolean
          name?: string
          plate?: string
          seats?: number
          transmission?: string
          updated_at?: string
          vehicle_identifier?: string
          vin?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          authorization_hold_amount_cents: number
          authorization_hold_capture_before: number | null
          authorization_hold_created_at: string | null
          authorization_hold_payment_intent_id: string | null
          authorization_hold_status: string | null
          created_at: string
          dropoff_location: string | null
          dropoff_time: string | null
          end_date: string
          grand_total_cents: number
          host_profile_id: string
          id: string
          odometer_end: number | null
          odometer_start: number | null
          pickup_location: string | null
          pickup_time: string | null
          rental_agreement_accepted_at: string | null
          reservation_number: string
          renter_profile_id: string
          service_fee_cents: number
          start_date: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          subtotal_cents: number
          taxes_cents: number
          terms_accepted_at: string | null
          trip_status: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          authorization_hold_amount_cents?: number
          authorization_hold_capture_before?: number | null
          authorization_hold_created_at?: string | null
          authorization_hold_payment_intent_id?: string | null
          authorization_hold_status?: string | null
          created_at?: string
          dropoff_location?: string | null
          dropoff_time?: string | null
          end_date: string
          grand_total_cents?: number
          host_profile_id?: string
          id?: string
          odometer_end?: number | null
          odometer_start?: number | null
          pickup_location?: string | null
          pickup_time?: string | null
          rental_agreement_accepted_at?: string | null
          reservation_number?: string
          renter_profile_id?: string
          service_fee_cents?: number
          start_date: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          subtotal_cents?: number
          taxes_cents?: number
          terms_accepted_at?: string | null
          trip_status?: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          authorization_hold_amount_cents?: number
          authorization_hold_capture_before?: number | null
          authorization_hold_created_at?: string | null
          authorization_hold_payment_intent_id?: string | null
          authorization_hold_status?: string | null
          created_at?: string
          dropoff_location?: string | null
          dropoff_time?: string | null
          end_date?: string
          grand_total_cents?: number
          host_profile_id?: string
          id?: string
          odometer_end?: number | null
          odometer_start?: number | null
          pickup_location?: string | null
          pickup_time?: string | null
          rental_agreement_accepted_at?: string | null
          reservation_number?: string
          renter_profile_id?: string
          service_fee_cents?: number
          start_date?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          subtotal_cents?: number
          taxes_cents?: number
          terms_accepted_at?: string | null
          trip_status?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_renter_profile_id_fkey"
            columns: ["renter_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      vehicle_blocked_periods: {
        Row: {
          created_at: string
          end_at: string
          host_profile_id: string
          id: string
          reason: string | null
          start_at: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          end_at: string
          host_profile_id: string
          id?: string
          reason?: string | null
          start_at: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          end_at?: string
          host_profile_id?: string
          id?: string
          reason?: string | null
          start_at?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_blocked_periods_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_blocked_periods_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_images: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          image_type: string
          image_url: string
          notes: string | null
          updated_at: string
          uploaded_by_profile_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          image_type: string
          image_url: string
          notes?: string | null
          updated_at?: string
          uploaded_by_profile_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          image_type?: string
          image_url?: string
          notes?: string | null
          updated_at?: string
          uploaded_by_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_images_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_images_uploaded_by_profile_id_fkey"
            columns: ["uploaded_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          created_by_profile_id: string | null
          discount_percent: number | null
          discount_type: string
          discount_value_cents: number | null
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          updated_at: string
          uses_count: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by_profile_id?: string | null
          discount_percent?: number | null
          discount_type: string
          discount_value_cents?: number | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
          uses_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by_profile_id?: string | null
          discount_percent?: number | null
          discount_type?: string
          discount_value_cents?: number | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_booking: {
        Args: {
          _dropoff_location?: string
          _dropoff_time?: string
          _end_date: string
          _pickup_location?: string
          _pickup_time?: string
          _rental_agreement_accepted?: boolean
          _start_date: string
          _terms_accepted?: boolean
          _vehicle_id: string
        }
        Returns: string
      }
      cancel_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      delete_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      update_booking_operational_details: {
        Args: {
          _booking_id: string
          _pickup_time?: string
          _dropoff_time?: string
          _subtotal_cents?: number
          _service_fee_cents?: number
          _taxes_cents?: number
        }
        Returns: undefined
      }
      validate_promo_code: {
        Args: { _code: string }
        Returns: {
          code: string
          discount_type: string
          discount_value_cents: number | null
          discount_percent: number | null
        }[]
      }
      increment_promo_code_usage: {
        Args: { _promo_code_id: string }
        Returns: undefined
      }
      current_profile_id: { Args: never; Returns: string | null }
      current_profile_is_admin: { Args: never; Returns: boolean }
      current_profile_is_host: { Args: never; Returns: boolean }
      generate_reservation_number: { Args: never; Returns: string }
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
