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
      after_trip_charges: {
        Row: { id: string; booking_id: string; host_profile_id: string; renter_profile_id: string; category: string; amount_cents: number; currency: string; explanation: string; status: string; payment_status: string; idempotency_key: string; submitted_at: string; status_changed_at: string; created_by_profile_id: string; created_at: string }
        Insert: { id?: string; booking_id: string; host_profile_id: string; renter_profile_id: string; category: string; amount_cents: number; currency?: string; explanation: string; status?: string; payment_status?: string; idempotency_key: string; submitted_at?: string; status_changed_at?: string; created_by_profile_id: string; created_at?: string }
        Update: { id?: string; booking_id?: string; host_profile_id?: string; renter_profile_id?: string; category?: string; amount_cents?: number; currency?: string; explanation?: string; status?: string; payment_status?: string; idempotency_key?: string; submitted_at?: string; status_changed_at?: string; created_by_profile_id?: string; created_at?: string }
        Relationships: []
      }
      after_trip_charge_evidence: {
        Row: { charge_id: string; rental_image_id: string; attached_by_profile_id: string; attached_at: string }
        Insert: { charge_id: string; rental_image_id: string; attached_by_profile_id: string; attached_at?: string }
        Update: { charge_id?: string; rental_image_id?: string; attached_by_profile_id?: string; attached_at?: string }
        Relationships: []
      }
      after_trip_reconciliations: {
        Row: { id:string; booking_id:string; source_ledger_entry_id:string; idempotency_key:string; proposal_fingerprint:string; reason:string; proposed_charges:Json; total_charge_cents:number; settlement_source:string; created_by_profile_id:string; created_at:string }
        Insert: { id?:string; booking_id:string; source_ledger_entry_id:string; idempotency_key:string; proposal_fingerprint:string; reason:string; proposed_charges:Json; total_charge_cents:number; settlement_source:string; created_by_profile_id:string; created_at?:string }
        Update: { id?:string; booking_id?:string; source_ledger_entry_id?:string; idempotency_key?:string; proposal_fingerprint?:string; reason?:string; proposed_charges?:Json; total_charge_cents?:number; settlement_source?:string; created_by_profile_id?:string; created_at?:string }
        Relationships: []
      }
      after_trip_charge_settlements: {
        Row: { id:string; booking_id:string; charge_id:string; source_ledger_entry_id:string; reconciliation_id:string|null; amount_cents:number; currency:string; settlement_source:string; status:string; idempotency_key:string; created_by_profile_id:string; created_at:string }
        Insert: { id?:string; booking_id:string; charge_id:string; source_ledger_entry_id:string; reconciliation_id?:string|null; amount_cents:number; currency:string; settlement_source:string; status?:string; idempotency_key:string; created_by_profile_id:string; created_at?:string }
        Update: { id?:string; booking_id?:string; charge_id?:string; source_ledger_entry_id?:string; reconciliation_id?:string|null; amount_cents?:number; currency?:string; settlement_source?:string; status?:string; idempotency_key?:string; created_by_profile_id?:string; created_at?:string }
        Relationships: []
      }
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
          display_order: number | null
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
          display_order?: number | null
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
          display_order?: number | null
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
          fulfillment_method: string | null
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
          fulfillment_method?: string | null
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
          fulfillment_method?: string | null
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
      transition_trip_status: {
        Args: { _booking_id: string; _new_status: string }
        Returns: undefined
      }
      get_booking_financial_summary: {
        Args: { _booking_id: string }
        Returns: Json
      }
      submit_after_trip_charge: {
        Args: { _booking_id: string; _category: string; _amount_cents: number; _explanation: string; _evidence_ids?: string[]; _idempotency_key?: string }
        Returns: string
      }
      admin_set_after_trip_charge_status: {
        Args: { _charge_id: string; _new_status: string; _reason: string }
        Returns: undefined
      }
      get_final_trip_receipt: {
        Args: { _booking_id: string }
        Returns: Json
      }
      prepare_historical_after_trip_reconciliation: {
        Args: { _booking_id:string; _charges:Json; _source_ledger_entry_id:string }
        Returns: Json
      }
      confirm_historical_after_trip_reconciliation: {
        Args: { _booking_id:string; _charges:Json; _source_ledger_entry_id:string; _reason:string; _idempotency_key:string; _proposal_fingerprint:string }
        Returns: string
      }
      admin_allocate_after_trip_settlement: {
        Args: { _charge_id:string; _source_ledger_entry_id:string; _amount_cents:number; _reason:string; _idempotency_key:string }
        Returns: string
      }
      get_booking_operational_read_model: {
        Args: never
        Returns: {
          id: string
          reservation_number: string
          renter_profile_id: string
          host_profile_id: string
          vehicle_id: string
          start_date: string
          pickup_time: string | null
          end_date: string
          dropoff_time: string | null
          pickup_location: string | null
          dropoff_location: string | null
          fulfillment_method: string | null
          trip_status: string
          original_booking_total_cents: number
          displayed_total_cents: number
          currency: string
          is_financially_reconciled: boolean
          deposit_authorized_cents: number
          deposit_captured_cents: number
          deposit_released_cents: number
          deposit_refunded_cents: number
          deposit_settled: boolean
          subtotal_cents: number
          service_fee_cents: number
          taxes_cents: number
          stripe_checkout_session_id: string | null
          authorization_hold_payment_intent_id: string | null
          authorization_hold_amount_cents: number
          authorization_hold_status: string | null
          vehicle_brand: string
          vehicle_model: string
          vehicle_image_url: string | null
          renter_name: string
          renter_email: string
          provider_name: string
          provider_email: string
        }[]
      }
      admin_correct_historical_trip_details: {
        Args: {
          _booking_id: string
          _start_date: string
          _pickup_time: string
          _end_date: string
          _dropoff_time: string
          _pickup_location: string
          _dropoff_location: string
          _fulfillment_method: string
          _reason: string
        }
        Returns: undefined
      }
      admin_correct_historical_booking_schedule: {
        Args: {
          _booking_id: string
          _start_date: string
          _pickup_time: string
          _end_date: string
          _dropoff_time: string
          _reason: string
        }
        Returns: undefined
      }
      persist_authorization_hold_outcome: {
        Args: {
          _booking_id: string
          _status: string
          _captured_amount_cents?: number
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
      get_my_account_capabilities: {
        Args: never
        Returns: {
          profile_id: string
          full_name: string
          email: string
          can_guest: boolean
          can_host: boolean
          can_admin: boolean
        }[]
      }
      generate_reservation_number: { Args: never; Returns: string }
      plan_booking_cancellation: {
        Args: {
          _booking_id: string
          _actor_role: string
          _actor_profile_id: string
          _cancel_type: string
          _trip_status: string
          _subtotal_cents: number
          _service_fee_cents: number
          _taxes_cents: number
          _grand_total_cents: number
          _has_refundable_payment: boolean
        }
        Returns: Record<string, unknown>
      }
      persist_booking_cancellation: {
        Args: {
          _booking_id: string
          _cancel_type: string
          _cancel_reason: string
          _actor_role: string
          _actor_profile_id: string
          _stripe_refund_id: string
          _refund_amount_cents: number
        }
        Returns: boolean
      }
      search_available_vehicles: {
        Args: {
          _start_date?: string
          _end_date?: string
          _pickup_time?: string
          _dropoff_time?: string
          _location?: string
        }
        Returns: Database["public"]["Tables"]["vehicles"]["Row"][]
      }
      check_vehicle_availability: {
        Args: {
          _vehicle_id: string
          _start_date: string
          _end_date: string
          _pickup_time?: string
          _dropoff_time?: string
        }
        Returns: boolean
      }
      get_my_driver_eligibility: {
        Args: { _trip_end_date?: string }
        Returns: {
          legal_name: string | null
          date_of_birth: string | null
          license_issuing_country: string | null
          license_issuing_region: string | null
          license_expiration_date: string | null
          self_attested_at: string | null
          status: string
        }[]
      }
      submit_my_driver_eligibility: {
        Args: {
          _legal_name: string
          _date_of_birth: string
          _license_issuing_country: string
          _license_issuing_region: string
          _license_expiration_date: string
          _attested: boolean
          _trip_end_date?: string
        }
        Returns: string
      }

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
