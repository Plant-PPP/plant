
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_costs": {
                  Row: {
                    "amount_usd": number,"cache_read_tokens": number,"cache_write_tokens": number,"cost_type": Database["public"]['Enums']["ai_cost_type"],"created_at": string,"id": string,"input_tokens": number,"model_id": string,"output_tokens": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_usd": number,"cache_read_tokens": number,"cache_write_tokens": number,"cost_type": Database["public"]['Enums']["ai_cost_type"],"created_at"?: string,"id"?: string,"input_tokens": number,"model_id": string,"output_tokens": number,"user_id": string
                  }
                  Update: {
                    "amount_usd"?: number,"cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_type"?: Database["public"]['Enums']["ai_cost_type"],"created_at"?: string,"id"?: string,"input_tokens"?: number,"model_id"?: string,"output_tokens"?: number,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"consents": {
                  Row: {
                    "accepted_at": string,"granted": boolean,"id": string,"kind": Database["public"]['Enums']["consent_kind"],"user_id": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string,"granted": boolean,"id"?: string,"kind": Database["public"]['Enums']["consent_kind"],"user_id"?: string,"version": string
                  }
                  Update: {
                    "accepted_at"?: string,"granted"?: boolean,"id"?: string,"kind"?: Database["public"]['Enums']["consent_kind"],"user_id"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"fx_rates": {
                  Row: {
                    "buy": number | null,"fetched_at": string,"kind": Database["public"]['Enums']["fx_rate_kind"],"quoted_at": string,"rate_date": string,"sell": number,"source": Database["public"]['Enums']["quote_source"]
                  }
                  ComputedFields: never
                  Insert: {
                    "buy"?: number | null,"fetched_at": string,"kind": Database["public"]['Enums']["fx_rate_kind"],"quoted_at": string,"rate_date": string,"sell": number,"source": Database["public"]['Enums']["quote_source"]
                  }
                  Update: {
                    "buy"?: number | null,"fetched_at"?: string,"kind"?: Database["public"]['Enums']["fx_rate_kind"],"quoted_at"?: string,"rate_date"?: string,"sell"?: number,"source"?: Database["public"]['Enums']["quote_source"]
                  }
                  Relationships: [
                    
                  ]
                },"portfolios": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"id": string,"name": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"name": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"prices": {
                  Row: {
                    "currency": Database["public"]['Enums']["currency"],"fetched_at": string,"price": number,"price_date": string,"quoted_at": string,"source": Database["public"]['Enums']["quote_source"],"symbol": string
                  }
                  ComputedFields: never
                  Insert: {
                    "currency": Database["public"]['Enums']["currency"],"fetched_at": string,"price": number,"price_date": string,"quoted_at": string,"source": Database["public"]['Enums']["quote_source"],"symbol": string
                  }
                  Update: {
                    "currency"?: Database["public"]['Enums']["currency"],"fetched_at"?: string,"price"?: number,"price_date"?: string,"quoted_at"?: string,"source"?: Database["public"]['Enums']["quote_source"],"symbol"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"reference_dollar": Database["public"]['Enums']["reference_dollar"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"reference_dollar"?: Database["public"]['Enums']["reference_dollar"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"reference_dollar"?: Database["public"]['Enums']["reference_dollar"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "ai_cost_type": "import_extraction","consent_kind": "terms"|"privacy"|"ai_providers","currency": "ARS"|"USD","fx_rate_kind": "official"|"mep"|"ccl"|"blue"|"uva","quote_source": "dolarapi"|"argentinadatos"|"kraken","reference_dollar": "mep"|"ccl"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "ai_cost_type": ["import_extraction"],"consent_kind": ["terms", "privacy", "ai_providers"],"currency": ["ARS", "USD"],"fx_rate_kind": ["official", "mep", "ccl", "blue", "uva"],"quote_source": ["dolarapi", "argentinadatos", "kraken"],"reference_dollar": ["mep", "ccl"]
          }
        }
} as const
