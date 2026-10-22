
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "account_api_keys": {
                  Row: {
                    "created_at": string,"credentials": Json | null,"id": string,"key_hint": string,"provider": string,"secret_ciphertext": string | null,"source_connection_id": string,"user_id": string,"vault_secret": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"credentials"?: Json | null,"id"?: string,"key_hint": string,"provider": string,"secret_ciphertext"?: string | null,"source_connection_id": string,"user_id"?: string,"vault_secret"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"credentials"?: Json | null,"id"?: string,"key_hint"?: string,"provider"?: string,"secret_ciphertext"?: string | null,"source_connection_id"?: string,"user_id"?: string,"vault_secret"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "account_api_keys_user_id_source_connection_id_fkey"
      columns: ["user_id","source_connection_id"]
isOneToOne: true
      referencedRelation: "source_connections"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"ai_conversations": {
                  Row: {
                    "created_at": string,"id": string,"questions": number,"title": string,"unit": Database["public"]['Enums']["chat_unit"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"questions"?: number,"title": string,"unit": Database["public"]['Enums']["chat_unit"],"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"questions"?: number,"title"?: string,"unit"?: Database["public"]['Enums']["chat_unit"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ai_costs": {
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
                },"ai_messages": {
                  Row: {
                    "conversation_id": string,"created_at": string,"id": string,"metadata": Json | null,"parts": NonNullable<Json>,"proposal_states": NonNullable<Json>,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"id": string,"metadata"?: Json | null,"parts": NonNullable<Json>,"proposal_states"?: NonNullable<Json>,"role": string,"user_id"?: string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"id"?: string,"metadata"?: Json | null,"parts"?: NonNullable<Json>,"proposal_states"?: NonNullable<Json>,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_messages_user_id_conversation_id_fkey"
      columns: ["user_id","conversation_id"]
isOneToOne: false
      referencedRelation: "ai_conversations"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"ai_questions": {
                  Row: {
                    "asked_at": string,"id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asked_at"?: string,"id"?: string,"user_id"?: string
                  }
                  Update: {
                    "asked_at"?: string,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"cash_movements": {
                  Row: {
                    "amount": number,"created_at": string,"date": string,"holding_id": string,"id": string,"kind": Database["public"]['Enums']["cash_movement_kind"],"note": string | null,"operation_id": string | null,"rates": NonNullable<Json>,"reference": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"date": string,"holding_id": string,"id"?: string,"kind": Database["public"]['Enums']["cash_movement_kind"],"note"?: string | null,"operation_id"?: string | null,"rates": NonNullable<Json>,"reference"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"date"?: string,"holding_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["cash_movement_kind"],"note"?: string | null,"operation_id"?: string | null,"rates"?: NonNullable<Json>,"reference"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_movements_user_id_holding_id_fkey"
      columns: ["user_id","holding_id"]
isOneToOne: false
      referencedRelation: "holdings"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "cash_movements_user_id_operation_id_fkey"
      columns: ["user_id","operation_id"]
isOneToOne: false
      referencedRelation: "operations"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"column_mappings": {
                  Row: {
                    "created_at": string,"header_signature": string,"id": string,"institution": string,"mapping": NonNullable<Json>,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"header_signature": string,"id"?: string,"institution": string,"mapping": NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"header_signature"?: string,"id"?: string,"institution"?: string,"mapping"?: NonNullable<Json>,"user_id"?: string
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
                },"holdings": {
                  Row: {
                    "amount": number,"annual_rate": number | null,"archived_at": string | null,"asset_class": Database["public"]['Enums']["asset_class"],"cost": number | null,"created_at": string,"currency": Database["public"]['Enums']["currency"] | null,"id": string,"instrument_symbol": string | null,"label": string | null,"matures_on": string | null,"movements_revision": number,"portfolio_id": string,"source_connection_id": string,"started_on": string | null,"updated_at": string,"user_id": string,"valued_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"annual_rate"?: number | null,"archived_at"?: string | null,"asset_class": Database["public"]['Enums']["asset_class"],"cost"?: number | null,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"] | null,"id"?: string,"instrument_symbol"?: string | null,"label"?: string | null,"matures_on"?: string | null,"movements_revision"?: number,"portfolio_id": string,"source_connection_id": string,"started_on"?: string | null,"updated_at"?: string,"user_id"?: string,"valued_on"?: string | null
                  }
                  Update: {
                    "amount"?: number,"annual_rate"?: number | null,"archived_at"?: string | null,"asset_class"?: Database["public"]['Enums']["asset_class"],"cost"?: number | null,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"] | null,"id"?: string,"instrument_symbol"?: string | null,"label"?: string | null,"matures_on"?: string | null,"movements_revision"?: number,"portfolio_id"?: string,"source_connection_id"?: string,"started_on"?: string | null,"updated_at"?: string,"user_id"?: string,"valued_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "holdings_instrument_symbol_fkey"
      columns: ["instrument_symbol"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["symbol"]
    },{
      foreignKeyName: "holdings_user_id_portfolio_id_fkey"
      columns: ["user_id","portfolio_id"]
isOneToOne: false
      referencedRelation: "portfolios"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "holdings_user_id_source_connection_id_fkey"
      columns: ["user_id","source_connection_id"]
isOneToOne: false
      referencedRelation: "source_connections"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"import_debts": {
                  Row: {
                    "accrues": boolean | null,"annual_rate": number | null,"balance": number | null,"confidence": Database["public"]['Enums']["import_confidence"],"created_at": string,"currency": Database["public"]['Enums']["currency"],"due_date": string | null,"id": string,"import_id": string,"instrument_symbol": string | null,"kind": Database["public"]['Enums']["liability_kind"] | null,"label": string | null,"lender": string | null,"minimum_payment": number | null,"opened_on": string | null,"position": number,"source_page": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accrues"?: boolean | null,"annual_rate"?: number | null,"balance"?: number | null,"confidence": Database["public"]['Enums']["import_confidence"],"created_at"?: string,"currency": Database["public"]['Enums']["currency"],"due_date"?: string | null,"id"?: string,"import_id": string,"instrument_symbol"?: string | null,"kind"?: Database["public"]['Enums']["liability_kind"] | null,"label"?: string | null,"lender"?: string | null,"minimum_payment"?: number | null,"opened_on"?: string | null,"position": number,"source_page"?: number | null,"user_id": string
                  }
                  Update: {
                    "accrues"?: boolean | null,"annual_rate"?: number | null,"balance"?: number | null,"confidence"?: Database["public"]['Enums']["import_confidence"],"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"due_date"?: string | null,"id"?: string,"import_id"?: string,"instrument_symbol"?: string | null,"kind"?: Database["public"]['Enums']["liability_kind"] | null,"label"?: string | null,"lender"?: string | null,"minimum_payment"?: number | null,"opened_on"?: string | null,"position"?: number,"source_page"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_debts_user_id_import_id_fkey"
      columns: ["user_id","import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"import_items": {
                  Row: {
                    "account": string | null,"asset_class": Database["public"]['Enums']["asset_class"],"confidence": Database["public"]['Enums']["import_confidence"],"cost": number | null,"created_at": string,"currency": Database["public"]['Enums']["currency"],"id": string,"import_id": string,"position": number,"price": number | null,"quantity": number,"source_page": number | null,"symbol": string,"user_id": string,"value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account"?: string | null,"asset_class"?: Database["public"]['Enums']["asset_class"],"confidence": Database["public"]['Enums']["import_confidence"],"cost"?: number | null,"created_at"?: string,"currency": Database["public"]['Enums']["currency"],"id"?: string,"import_id": string,"position": number,"price"?: number | null,"quantity": number,"source_page"?: number | null,"symbol": string,"user_id": string,"value"?: number | null
                  }
                  Update: {
                    "account"?: string | null,"asset_class"?: Database["public"]['Enums']["asset_class"],"confidence"?: Database["public"]['Enums']["import_confidence"],"cost"?: number | null,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"id"?: string,"import_id"?: string,"position"?: number,"price"?: number | null,"quantity"?: number,"source_page"?: number | null,"symbol"?: string,"user_id"?: string,"value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_items_user_id_import_id_fkey"
      columns: ["user_id","import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"import_operations": {
                  Row: {
                    "amount": number | null,"charges": number | null,"confidence": Database["public"]['Enums']["import_confidence"],"created_at": string,"currency": Database["public"]['Enums']["currency"],"date": string | null,"id": string,"import_id": string,"kind": Database["public"]['Enums']["movement_kind"] | null,"position": number,"price": number | null,"quantity": number | null,"reference": string | null,"source_page": number | null,"symbol": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"charges"?: number | null,"confidence": Database["public"]['Enums']["import_confidence"],"created_at"?: string,"currency": Database["public"]['Enums']["currency"],"date"?: string | null,"id"?: string,"import_id": string,"kind"?: Database["public"]['Enums']["movement_kind"] | null,"position": number,"price"?: number | null,"quantity"?: number | null,"reference"?: string | null,"source_page"?: number | null,"symbol"?: string | null,"user_id": string
                  }
                  Update: {
                    "amount"?: number | null,"charges"?: number | null,"confidence"?: Database["public"]['Enums']["import_confidence"],"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"date"?: string | null,"id"?: string,"import_id"?: string,"kind"?: Database["public"]['Enums']["movement_kind"] | null,"position"?: number,"price"?: number | null,"quantity"?: number | null,"reference"?: string | null,"source_page"?: number | null,"symbol"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_operations_user_id_import_id_fkey"
      columns: ["user_id","import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"imports": {
                  Row: {
                    "created_at": string,"document_date": string | null,"document_id": string | null,"failure": Database["public"]['Enums']["import_failure"] | null,"id": string,"printed_total_ars": number | null,"printed_total_usd": number | null,"provider": string | null,"read_run_id": string | null,"skipped_rows": number,"source_connection_id": string | null,"status": Database["public"]['Enums']["import_status"],"sync_cash": Json | null,"sync_draft": string | null,"sync_from": string | null,"sync_to": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"document_date"?: string | null,"document_id"?: string | null,"failure"?: Database["public"]['Enums']["import_failure"] | null,"id"?: string,"printed_total_ars"?: number | null,"printed_total_usd"?: number | null,"provider"?: string | null,"read_run_id"?: string | null,"skipped_rows"?: number,"source_connection_id"?: string | null,"status"?: Database["public"]['Enums']["import_status"],"sync_cash"?: Json | null,"sync_draft"?: string | null,"sync_from"?: string | null,"sync_to"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"document_date"?: string | null,"document_id"?: string | null,"failure"?: Database["public"]['Enums']["import_failure"] | null,"id"?: string,"printed_total_ars"?: number | null,"printed_total_usd"?: number | null,"provider"?: string | null,"read_run_id"?: string | null,"skipped_rows"?: number,"source_connection_id"?: string | null,"status"?: Database["public"]['Enums']["import_status"],"sync_cash"?: Json | null,"sync_draft"?: string | null,"sync_from"?: string | null,"sync_to"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "imports_user_id_document_id_fkey"
      columns: ["user_id","document_id"]
isOneToOne: true
      referencedRelation: "uploaded_documents"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "imports_user_id_source_connection_id_fkey"
      columns: ["user_id","source_connection_id"]
isOneToOne: false
      referencedRelation: "source_connections"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"instruments": {
                  Row: {
                    "aliases": (string)[],"currency": Database["public"]['Enums']["currency"],"name": string,"symbol": string,"type": Database["public"]['Enums']["instrument_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "aliases"?: (string)[],"currency": Database["public"]['Enums']["currency"],"name": string,"symbol": string,"type": Database["public"]['Enums']["instrument_type"]
                  }
                  Update: {
                    "aliases"?: (string)[],"currency"?: Database["public"]['Enums']["currency"],"name"?: string,"symbol"?: string,"type"?: Database["public"]['Enums']["instrument_type"]
                  }
                  Relationships: [
                    
                  ]
                },"liabilities": {
                  Row: {
                    "accrues": boolean,"anchored_on": string,"annual_rate": number | null,"balance": number,"created_at": string,"currency": Database["public"]['Enums']["currency"] | null,"disbursement_operation_id": string | null,"id": string,"installment": number | null,"installments_left": number | null,"instrument_symbol": string | null,"kind": Database["public"]['Enums']["liability_kind"],"label": string,"lender": string | null,"matures_on": string | null,"next_due_on": string | null,"opened_on": string | null,"principal": number | null,"updated_at": string,"user_id": string,"uva": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "accrues"?: boolean,"anchored_on"?: string,"annual_rate"?: number | null,"balance": number,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"] | null,"disbursement_operation_id"?: string | null,"id"?: string,"installment"?: number | null,"installments_left"?: number | null,"instrument_symbol"?: string | null,"kind": Database["public"]['Enums']["liability_kind"],"label": string,"lender"?: string | null,"matures_on"?: string | null,"next_due_on"?: string | null,"opened_on"?: string | null,"principal"?: number | null,"updated_at"?: string,"user_id"?: string,"uva"?: boolean
                  }
                  Update: {
                    "accrues"?: boolean,"anchored_on"?: string,"annual_rate"?: number | null,"balance"?: number,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"] | null,"disbursement_operation_id"?: string | null,"id"?: string,"installment"?: number | null,"installments_left"?: number | null,"instrument_symbol"?: string | null,"kind"?: Database["public"]['Enums']["liability_kind"],"label"?: string,"lender"?: string | null,"matures_on"?: string | null,"next_due_on"?: string | null,"opened_on"?: string | null,"principal"?: number | null,"updated_at"?: string,"user_id"?: string,"uva"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "liabilities_disbursement_operation_fkey"
      columns: ["user_id","disbursement_operation_id"]
isOneToOne: false
      referencedRelation: "operations"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "liabilities_instrument_symbol_fkey"
      columns: ["instrument_symbol"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["symbol"]
    }
                  ]
                },"liability_collateral": {
                  Row: {
                    "created_at": string,"holding_id": string,"id": string,"liability_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"holding_id": string,"id"?: string,"liability_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"holding_id"?: string,"id"?: string,"liability_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "liability_collateral_user_id_holding_id_fkey"
      columns: ["user_id","holding_id"]
isOneToOne: false
      referencedRelation: "holdings"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "liability_collateral_user_id_liability_id_fkey"
      columns: ["user_id","liability_id"]
isOneToOne: false
      referencedRelation: "liabilities"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"liability_events": {
                  Row: {
                    "amount": number | null,"annual_rate": number | null,"cash_holding_id": string | null,"created_at": string,"date": string,"id": string,"kind": Database["public"]['Enums']["liability_event_kind"],"liability_id": string,"settles": boolean,"takes_cash": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"annual_rate"?: number | null,"cash_holding_id"?: string | null,"created_at"?: string,"date": string,"id"?: string,"kind": Database["public"]['Enums']["liability_event_kind"],"liability_id": string,"settles"?: boolean,"takes_cash"?: boolean,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number | null,"annual_rate"?: number | null,"cash_holding_id"?: string | null,"created_at"?: string,"date"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["liability_event_kind"],"liability_id"?: string,"settles"?: boolean,"takes_cash"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "liability_events_user_id_cash_holding_id_fkey"
      columns: ["user_id","cash_holding_id"]
isOneToOne: false
      referencedRelation: "holdings"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "liability_events_user_id_liability_id_fkey"
      columns: ["user_id","liability_id"]
isOneToOne: false
      referencedRelation: "liabilities"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"manual_prices": {
                  Row: {
                    "created_at": string,"currency": Database["public"]['Enums']["currency"],"id": string,"price": number,"price_date": string,"symbol": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency": Database["public"]['Enums']["currency"],"id"?: string,"price": number,"price_date": string,"symbol": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"id"?: string,"price"?: number,"price_date"?: string,"symbol"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "manual_prices_symbol_fkey"
      columns: ["symbol"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["symbol"]
    }
                  ]
                },"manual_rates": {
                  Row: {
                    "created_at": string,"id": string,"kind": Database["public"]['Enums']["manual_rate_kind"],"rate_date": string,"sell": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["manual_rate_kind"],"rate_date": string,"sell": number,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["manual_rate_kind"],"rate_date"?: string,"sell"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"movements": {
                  Row: {
                    "amount": number | null,"charges": NonNullable<Json>,"created_at": string,"currency": Database["public"]['Enums']["currency"],"date": string,"direction": Database["public"]['Enums']["movement_direction"] | null,"entry_order": number,"holding_id": string,"id": string,"kind": Database["public"]['Enums']["movement_kind"],"note": string | null,"operation_id": string,"price": number | null,"quantity": number | null,"rank": number,"rates": NonNullable<Json>,"reference": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"charges"?: NonNullable<Json>,"created_at"?: string,"currency": Database["public"]['Enums']["currency"],"date": string,"direction"?: Database["public"]['Enums']["movement_direction"] | null,"entry_order": number,"holding_id": string,"id"?: string,"kind": Database["public"]['Enums']["movement_kind"],"note"?: string | null,"operation_id": string,"price"?: number | null,"quantity"?: number | null,"rank"?: never,"rates": NonNullable<Json>,"reference"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number | null,"charges"?: NonNullable<Json>,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"date"?: string,"direction"?: Database["public"]['Enums']["movement_direction"] | null,"entry_order"?: number,"holding_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["movement_kind"],"note"?: string | null,"operation_id"?: string,"price"?: number | null,"quantity"?: number | null,"rank"?: never,"rates"?: NonNullable<Json>,"reference"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "movements_user_id_holding_id_fkey"
      columns: ["user_id","holding_id"]
isOneToOne: false
      referencedRelation: "holdings"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "movements_user_id_operation_id_fkey"
      columns: ["user_id","operation_id"]
isOneToOne: false
      referencedRelation: "operations"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"operations": {
                  Row: {
                    "created_at": string,"entry_order": number,"id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"entry_order": number,"id"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"entry_order"?: number,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pinned_charts": {
                  Row: {
                    "created_at": string,"id": string,"portfolio_id": string | null,"topic": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"portfolio_id"?: string | null,"topic": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"portfolio_id"?: string | null,"topic"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pinned_charts_user_id_portfolio_id_fkey"
      columns: ["user_id","portfolio_id"]
isOneToOne: false
      referencedRelation: "portfolios"
      referencedColumns: ["user_id","id"]
    }
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
                },"price_alerts": {
                  Row: {
                    "cost_price": number | null,"created_at": string,"currency": Database["public"]['Enums']["currency"],"direction": string,"gain_percent": number | null,"id": string,"met_on": string | null,"met_price": number | null,"seen_at": string | null,"subject": string,"subject_kind": string,"threshold": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_price"?: number | null,"created_at"?: string,"currency": Database["public"]['Enums']["currency"],"direction": string,"gain_percent"?: number | null,"id"?: string,"met_on"?: string | null,"met_price"?: number | null,"seen_at"?: string | null,"subject": string,"subject_kind": string,"threshold"?: number | null,"user_id"?: string
                  }
                  Update: {
                    "cost_price"?: number | null,"created_at"?: string,"currency"?: Database["public"]['Enums']["currency"],"direction"?: string,"gain_percent"?: number | null,"id"?: string,"met_on"?: string | null,"met_price"?: number | null,"seen_at"?: string | null,"subject"?: string,"subject_kind"?: string,"threshold"?: number | null,"user_id"?: string
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
                },"source_connections": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"default_portfolio_id": string,"icon": string | null,"id": string,"include_in_tax_report": boolean,"institution": string,"updated_at": string,"user_id": string,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"default_portfolio_id": string,"icon"?: string | null,"id"?: string,"include_in_tax_report"?: boolean,"institution": string,"updated_at"?: string,"user_id"?: string,"website"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"default_portfolio_id"?: string,"icon"?: string | null,"id"?: string,"include_in_tax_report"?: boolean,"institution"?: string,"updated_at"?: string,"user_id"?: string,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "source_connections_user_id_default_portfolio_id_fkey"
      columns: ["user_id","default_portfolio_id"]
isOneToOne: false
      referencedRelation: "portfolios"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"tax_report_exclusions": {
                  Row: {
                    "created_at": string,"holding_id": string | null,"id": string,"instrument_symbol": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"holding_id"?: string | null,"id"?: string,"instrument_symbol"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"holding_id"?: string | null,"id"?: string,"instrument_symbol"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tax_report_exclusions_instrument_symbol_fkey"
      columns: ["instrument_symbol"]
isOneToOne: false
      referencedRelation: "instruments"
      referencedColumns: ["symbol"]
    },{
      foreignKeyName: "tax_report_exclusions_user_id_holding_id_fkey"
      columns: ["user_id","holding_id"]
isOneToOne: true
      referencedRelation: "holdings"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"uploaded_documents": {
                  Row: {
                    "created_at": string,"delete_after": string,"file_deleted_at": string | null,"file_name": string,"id": string,"mime_type": string,"sha256": string,"size_bytes": number,"source_connection_id": string | null,"storage_path": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"delete_after"?: string,"file_deleted_at"?: string | null,"file_name": string,"id"?: string,"mime_type": string,"sha256": string,"size_bytes": number,"source_connection_id"?: string | null,"storage_path": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"delete_after"?: string,"file_deleted_at"?: string | null,"file_name"?: string,"id"?: string,"mime_type"?: string,"sha256"?: string,"size_bytes"?: number,"source_connection_id"?: string | null,"storage_path"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "uploaded_documents_user_id_source_connection_id_fkey"
      columns: ["user_id","source_connection_id"]
isOneToOne: false
      referencedRelation: "source_connections"
      referencedColumns: ["user_id","id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "account_credentials":
{ Args: { "p_provider": string,"p_source_connection_id": string,"p_user_id": string }; Returns: Json
                           },
"audit_data_export":
{ Args: { "p_outcome": string,"p_request_id"?: string,"p_user_id": string }; Returns: undefined
                           },
"backfill_fx_rates":
{ Args: { "p_rows": Json }; Returns: number
                           },
"confirm_import":
{ Args: { "p_import_id": string,"p_operations": Json }; Returns: string
                           },
"confirm_import_debts":
{ Args: { "p_debts": Json,"p_import_id": string }; Returns: string
                           },
"delete_liability_event":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"imports_used_this_month":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"meet_price_alerts":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"move_cash":
{ Args: { "p_currency": Database["public"]['Enums']["currency"],"p_delta": number,"p_expected": number,"p_holding_id": string }; Returns: undefined
                           },
"orphan_import_files":
{ Args: { "p_after"?: string,"p_limit": number }; Returns: {
              "id": string,"name": string
            }[]
                           },
"quotes_before":
{ Args: { "p_before": string,"p_fx_kinds": (Database["public"]['Enums']["fx_rate_kind"])[],"p_symbols": (string)[] }; Returns: {
              "amount": string,"currency": Database["public"]['Enums']["currency"],"kind": Database["public"]['Enums']["fx_rate_kind"],"quote_date": string,"symbol": string
            }[]
                           },
"record_liability_event":
{ Args: { "p_cash": Json,"p_event": Json,"p_liability_id": string }; Returns: string
                           },
"restore_cash":
{ Args: { "p_amount": number,"p_currency": Database["public"]['Enums']["currency"],"p_holding_id": string }; Returns: string
                           },
"save_first_prices":
{ Args: { "p_rows": Json }; Returns: number
                           },
"stage_assistant_import":
{ Args: { "p_draft": string,"p_rows": Json,"p_source_connection_id": string }; Returns: string
                           },
"supersede_queued_sync":
{ Args: { "p_provider": string,"p_queued_id": string,"p_source_connection_id": string,"p_sync_draft": string,"p_sync_from"?: string,"p_sync_to"?: string }; Returns: string
                           },
"update_liability_event":
{ Args: { "p_cash": Json,"p_event": Json,"p_event_id": string }; Returns: boolean
                           },
"write_cash_movements":
{ Args: { "p_deletes": (string)[],"p_holding_id": string,"p_inserts": Json }; Returns: (string)[]
                           },
"write_operation":
{ Args: { "p_expected": Json,"p_operation_id": string,"p_parts": Json }; Returns: string
                           } |
{ Args: { "p_expected": Json,"p_last": boolean,"p_operation_id": string,"p_parts": Json }; Returns: string
                           }
          }
          Enums: {
            "ai_cost_type": "import_extraction"|"import_column_mapping"|"assistant_chat","asset_class": "instrument"|"cash"|"fixed_term"|"real_estate"|"other","cash_movement_kind": "opening_balance"|"deposit"|"withdrawal"|"settlement"|"income"|"charge","chat_unit": "ars"|"usd_mep"|"usd_ccl","consent_kind": "terms"|"privacy"|"ai_providers","currency": "ARS"|"USD"|"EUR","fx_rate_kind": "official"|"mep"|"ccl"|"blue"|"eur"|"uva","import_confidence": "high"|"medium"|"low","import_failure": "unsupported"|"unreadable"|"nothing_found"|"extraction_failed"|"too_many_pages"|"connection_rejected"|"connection_not_read_only","import_status": "queued"|"reading"|"ready"|"failed"|"confirmed","instrument_type": "crypto"|"cedear"|"stock"|"etf"|"bond"|"fci","liability_event_kind": "rate_change"|"payment"|"adjustment","liability_kind": "personal_loan"|"mortgage"|"credit_card"|"usd_debt"|"crypto_loan","manual_rate_kind": "mep"|"ccl"|"official","movement_direction": "in"|"out","movement_kind": "opening_balance"|"purchase"|"sale"|"dividend"|"coupon"|"adjustment"|"transfer"|"yield","quote_source": "dolarapi"|"argentinadatos"|"kraken"|"iol"|"yahoo"|"coingecko","reference_dollar": "mep"|"ccl"
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
            "ai_cost_type": ["import_extraction", "import_column_mapping", "assistant_chat"],"asset_class": ["instrument", "cash", "fixed_term", "real_estate", "other"],"cash_movement_kind": ["opening_balance", "deposit", "withdrawal", "settlement", "income", "charge"],"chat_unit": ["ars", "usd_mep", "usd_ccl"],"consent_kind": ["terms", "privacy", "ai_providers"],"currency": ["ARS", "USD", "EUR"],"fx_rate_kind": ["official", "mep", "ccl", "blue", "eur", "uva"],"import_confidence": ["high", "medium", "low"],"import_failure": ["unsupported", "unreadable", "nothing_found", "extraction_failed", "too_many_pages", "connection_rejected", "connection_not_read_only"],"import_status": ["queued", "reading", "ready", "failed", "confirmed"],"instrument_type": ["crypto", "cedear", "stock", "etf", "bond", "fci"],"liability_event_kind": ["rate_change", "payment", "adjustment"],"liability_kind": ["personal_loan", "mortgage", "credit_card", "usd_debt", "crypto_loan"],"manual_rate_kind": ["mep", "ccl", "official"],"movement_direction": ["in", "out"],"movement_kind": ["opening_balance", "purchase", "sale", "dividend", "coupon", "adjustment", "transfer", "yield"],"quote_source": ["dolarapi", "argentinadatos", "kraken", "iol", "yahoo", "coingecko"],"reference_dollar": ["mep", "ccl"]
          }
        }
} as const
