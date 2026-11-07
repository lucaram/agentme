
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agent_facts": {
                  Row: {
                    "agent_id": string,"category": string,"disclosure": Database["public"]['Enums']["disclosure_level"],"id": string,"updated_at": string,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"category": string,"disclosure"?: Database["public"]['Enums']["disclosure_level"],"id"?: string,"updated_at"?: string,"value": string
                  }
                  Update: {
                    "agent_id"?: string,"category"?: string,"disclosure"?: Database["public"]['Enums']["disclosure_level"],"id"?: string,"updated_at"?: string,"value"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_facts_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"agents": {
                  Row: {
                    "avatar": string,"bio": string | null,"business_info": NonNullable<Json>,"contact_policy": Database["public"]['Enums']["contact_policy"],"created_at": string,"display_name": string,"handle": string,"id": string,"owner_id": string,"type": Database["public"]['Enums']["agent_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar"?: string,"bio"?: string | null,"business_info"?: NonNullable<Json>,"contact_policy"?: Database["public"]['Enums']["contact_policy"],"created_at"?: string,"display_name": string,"handle": string,"id"?: string,"owner_id": string,"type"?: Database["public"]['Enums']["agent_type"]
                  }
                  Update: {
                    "avatar"?: string,"bio"?: string | null,"business_info"?: NonNullable<Json>,"contact_policy"?: Database["public"]['Enums']["contact_policy"],"created_at"?: string,"display_name"?: string,"handle"?: string,"id"?: string,"owner_id"?: string,"type"?: Database["public"]['Enums']["agent_type"]
                  }
                  Relationships: [
                    
                  ]
                },"contacts": {
                  Row: {
                    "addressee_agent": string,"blocked_by": string | null,"created_at": string,"id": string,"requester_agent": string,"status": Database["public"]['Enums']["contact_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "addressee_agent": string,"blocked_by"?: string | null,"created_at"?: string,"id"?: string,"requester_agent": string,"status"?: Database["public"]['Enums']["contact_status"]
                  }
                  Update: {
                    "addressee_agent"?: string,"blocked_by"?: string | null,"created_at"?: string,"id"?: string,"requester_agent"?: string,"status"?: Database["public"]['Enums']["contact_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_addressee_agent_fkey"
      columns: ["addressee_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_blocked_by_fkey"
      columns: ["blocked_by"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_requester_agent_fkey"
      columns: ["requester_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_members": {
                  Row: {
                    "conversation_id": string,"joined_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"joined_at"?: string,"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"joined_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_members_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"kind": Database["public"]['Enums']["conversation_kind"],"target_agent": string | null,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["conversation_kind"],"target_agent"?: string | null,"title"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["conversation_kind"],"target_agent"?: string | null,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_target_agent_fkey"
      columns: ["target_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"inbox_items": {
                  Row: {
                    "agent_id": string,"answer": Json | null,"answered_at": string | null,"created_at": string,"exchange_id": string | null,"from_agent": string | null,"id": string,"kind": string,"owner_id": string,"payload": NonNullable<Json>,"status": string,"task_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"answer"?: Json | null,"answered_at"?: string | null,"created_at"?: string,"exchange_id"?: string | null,"from_agent"?: string | null,"id"?: string,"kind"?: string,"owner_id": string,"payload": NonNullable<Json>,"status"?: string,"task_id"?: string | null
                  }
                  Update: {
                    "agent_id"?: string,"answer"?: Json | null,"answered_at"?: string | null,"created_at"?: string,"exchange_id"?: string | null,"from_agent"?: string | null,"id"?: string,"kind"?: string,"owner_id"?: string,"payload"?: NonNullable<Json>,"status"?: string,"task_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inbox_items_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inbox_items_exchange_id_fkey"
      columns: ["exchange_id"]
isOneToOne: false
      referencedRelation: "task_exchanges"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inbox_items_from_agent_fkey"
      columns: ["from_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inbox_items_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"item_claims": {
                  Row: {
                    "agent_id": string,"created_at": string,"item": string,"step_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"created_at"?: string,"item": string,"step_id": string
                  }
                  Update: {
                    "agent_id"?: string,"created_at"?: string,"item"?: string,"step_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "item_claims_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "item_claims_step_id_fkey"
      columns: ["step_id"]
isOneToOne: false
      referencedRelation: "plan_steps"
      referencedColumns: ["id"]
    }
                  ]
                },"llm_usage": {
                  Row: {
                    "agent_id": string | null,"cache_read_tokens": number,"cost_usd": number,"created_at": string,"id": string,"input_tokens": number,"model": string,"ok": boolean,"output_tokens": number,"provider": string,"purpose": string,"task_id": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id"?: string | null,"cache_read_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"id"?: string,"input_tokens"?: number,"model": string,"ok"?: boolean,"output_tokens"?: number,"provider": string,"purpose": string,"task_id"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "agent_id"?: string | null,"cache_read_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"id"?: string,"input_tokens"?: number,"model"?: string,"ok"?: boolean,"output_tokens"?: number,"provider"?: string,"purpose"?: string,"task_id"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "llm_usage_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "llm_usage_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "content": string,"conversation_id": string,"created_at": string,"id": string,"is_ai_generated": boolean,"metadata": NonNullable<Json>,"sender_agent_id": string | null,"sender_user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"conversation_id": string,"created_at"?: string,"id"?: string,"is_ai_generated": boolean,"metadata"?: NonNullable<Json>,"sender_agent_id"?: string | null,"sender_user_id"?: string | null
                  }
                  Update: {
                    "content"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"is_ai_generated"?: boolean,"metadata"?: NonNullable<Json>,"sender_agent_id"?: string | null,"sender_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_agent_id_fkey"
      columns: ["sender_agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"plan_changes": {
                  Row: {
                    "after": NonNullable<Json>,"before": NonNullable<Json>,"changed_by": string | null,"created_at": string,"id": string,"reset_rsvps": boolean,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "after": NonNullable<Json>,"before": NonNullable<Json>,"changed_by"?: string | null,"created_at"?: string,"id"?: string,"reset_rsvps": boolean,"task_id": string
                  }
                  Update: {
                    "after"?: NonNullable<Json>,"before"?: NonNullable<Json>,"changed_by"?: string | null,"created_at"?: string,"id"?: string,"reset_rsvps"?: boolean,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_changes_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_changes_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"plan_steps": {
                  Row: {
                    "config": NonNullable<Json>,"id": string,"position": number,"result": Json | null,"status": string,"task_id": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"id"?: string,"position": number,"result"?: Json | null,"status"?: string,"task_id": string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"id"?: string,"position"?: number,"result"?: Json | null,"status"?: string,"task_id"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_steps_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"proposals": {
                  Row: {
                    "content": NonNullable<Json>,"created_at": string,"group_conversation_id": string | null,"id": string,"status": Database["public"]['Enums']["proposal_status"],"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": NonNullable<Json>,"created_at"?: string,"group_conversation_id"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["proposal_status"],"task_id": string
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"group_conversation_id"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["proposal_status"],"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "proposals_group_conversation_id_fkey"
      columns: ["group_conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "proposals_task_id_fkey"
      columns: ["task_id"]
isOneToOne: true
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limits": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"step_responses": {
                  Row: {
                    "agent_id": string,"answered_by": string,"step_id": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"answered_by"?: string,"step_id": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "agent_id"?: string,"answered_by"?: string,"step_id"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "step_responses_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "step_responses_step_id_fkey"
      columns: ["step_id"]
isOneToOne: false
      referencedRelation: "plan_steps"
      referencedColumns: ["id"]
    }
                  ]
                },"task_exchanges": {
                  Row: {
                    "a2a_task_id": string | null,"answered_by": string | null,"created_at": string,"disclosed_categories": (string)[],"error": string | null,"from_agent": string | null,"id": string,"latency_ms": number | null,"request": NonNullable<Json>,"response": Json | null,"skill": string,"status": Database["public"]['Enums']["exchange_status"],"task_id": string | null,"to_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "a2a_task_id"?: string | null,"answered_by"?: string | null,"created_at"?: string,"disclosed_categories"?: (string)[],"error"?: string | null,"from_agent"?: string | null,"id"?: string,"latency_ms"?: number | null,"request"?: NonNullable<Json>,"response"?: Json | null,"skill": string,"status"?: Database["public"]['Enums']["exchange_status"],"task_id"?: string | null,"to_agent"?: string | null
                  }
                  Update: {
                    "a2a_task_id"?: string | null,"answered_by"?: string | null,"created_at"?: string,"disclosed_categories"?: (string)[],"error"?: string | null,"from_agent"?: string | null,"id"?: string,"latency_ms"?: number | null,"request"?: NonNullable<Json>,"response"?: Json | null,"skill"?: string,"status"?: Database["public"]['Enums']["exchange_status"],"task_id"?: string | null,"to_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_exchanges_from_agent_fkey"
      columns: ["from_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_exchanges_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_exchanges_to_agent_fkey"
      columns: ["to_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "attempts": number,"conversation_id": string,"created_at": string,"error": string | null,"goal": string,"group_conversation_id": string | null,"id": string,"initiator_agent": string,"lease_token": string | null,"lease_until": string | null,"owner_id": string,"parsed": NonNullable<Json>,"status": Database["public"]['Enums']["task_status"],"updated_at": string,"wake_requested": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"conversation_id": string,"created_at"?: string,"error"?: string | null,"goal": string,"group_conversation_id"?: string | null,"id"?: string,"initiator_agent": string,"lease_token"?: string | null,"lease_until"?: string | null,"owner_id": string,"parsed"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["task_status"],"updated_at"?: string,"wake_requested"?: boolean
                  }
                  Update: {
                    "attempts"?: number,"conversation_id"?: string,"created_at"?: string,"error"?: string | null,"goal"?: string,"group_conversation_id"?: string | null,"id"?: string,"initiator_agent"?: string,"lease_token"?: string | null,"lease_until"?: string | null,"owner_id"?: string,"parsed"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["task_status"],"updated_at"?: string,"wake_requested"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_group_conversation_id_fkey"
      columns: ["group_conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_initiator_agent_fkey"
      columns: ["initiator_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "can_see_task":
{ Args: { "p_task": string }; Returns: boolean
                           },
"claim_task":
{ Args: { "p_lease_seconds": number,"p_task": string }; Returns: {
              "attempts": number,
"conversation_id": string,
"created_at": string,
"error": string | null,
"goal": string,
"group_conversation_id": string | null,
"id": string,
"initiator_agent": string,
"lease_token": string | null,
"lease_until": string | null,
"owner_id": string,
"parsed": NonNullable<Json>,
"status": Database["public"]['Enums']["task_status"],
"updated_at": string,
"wake_requested": boolean
            }[]
                          SetofOptions: {
        from: "*"
        to: "tasks"
        isOneToOne: false
        isSetofReturn: true
      } },
"is_conversation_member":
{ Args: { "conv": string }; Returns: boolean
                           },
"my_agent_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"retry_after_seconds": number
            }[]
                           },
"renew_task_lease":
{ Args: { "p_lease_seconds": number,"p_task": string,"p_token": string }; Returns: boolean
                           }
          }
          Enums: {
            "agent_type": "personal"|"business","contact_policy": "contacts_only"|"anyone"|"nobody","contact_status": "pending"|"accepted"|"blocked","conversation_kind": "dm"|"group"|"my_agent"|"agent_chat","disclosure_level": "private"|"contacts","exchange_status": "pending"|"completed"|"refused"|"failed"|"waiting_human","proposal_status": "pending"|"accepted"|"rejected","task_status": "awaiting_approval"|"running"|"proposal_ready"|"accepted"|"rejected"|"cancelled"|"failed"|"waiting"|"completed"
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
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "agent_type": ["personal", "business"],"contact_policy": ["contacts_only", "anyone", "nobody"],"contact_status": ["pending", "accepted", "blocked"],"conversation_kind": ["dm", "group", "my_agent", "agent_chat"],"disclosure_level": ["private", "contacts"],"exchange_status": ["pending", "completed", "refused", "failed", "waiting_human"],"proposal_status": ["pending", "accepted", "rejected"],"task_status": ["awaiting_approval", "running", "proposal_ready", "accepted", "rejected", "cancelled", "failed", "waiting", "completed"]
          }
        }
} as const
