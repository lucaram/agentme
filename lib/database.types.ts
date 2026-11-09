
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
                    "agent_id": string,"category": string,"disclosure": Database["public"]['Enums']["disclosure_level"],"expires_at": string | null,"id": string,"label": string,"updated_at": string,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"category": string,"disclosure"?: Database["public"]['Enums']["disclosure_level"],"expires_at"?: string | null,"id"?: string,"label"?: string,"updated_at"?: string,"value": string
                  }
                  Update: {
                    "agent_id"?: string,"category"?: string,"disclosure"?: Database["public"]['Enums']["disclosure_level"],"expires_at"?: string | null,"id"?: string,"label"?: string,"updated_at"?: string,"value"?: string
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
                },"agent_identifiers": {
                  Row: {
                    "agent_id": string,"hash": string,"hint": string,"kind": string,"verified_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"hash": string,"hint": string,"kind": string,"verified_at"?: string
                  }
                  Update: {
                    "agent_id"?: string,"hash"?: string,"hint"?: string,"kind"?: string,"verified_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_identifiers_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_thread_tasks": {
                  Row: {
                    "task_id": string,"thread_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "task_id": string,"thread_id": string
                  }
                  Update: {
                    "task_id"?: string,"thread_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_thread_tasks_task_id_fkey"
      columns: ["task_id"]
isOneToOne: true
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_thread_tasks_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "agent_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_threads": {
                  Row: {
                    "conversation_id": string,"created_at": string,"id": string,"kind": string,"last_activity_at": string,"last_read_at": string,"owner_id": string,"renamed": boolean,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"id"?: string,"kind"?: string,"last_activity_at"?: string,"last_read_at"?: string,"owner_id": string,"renamed"?: boolean,"title"?: string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"last_activity_at"?: string,"last_read_at"?: string,"owner_id"?: string,"renamed"?: boolean,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_threads_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_tips": {
                  Row: {
                    "agent_id": string,"created_at": string,"id": string,"tip": string,"topic": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"created_at"?: string,"id"?: string,"tip": string,"topic": string
                  }
                  Update: {
                    "agent_id"?: string,"created_at"?: string,"id"?: string,"tip"?: string,"topic"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_tips_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"agents": {
                  Row: {
                    "appearance": NonNullable<Json>,"avatar": string,"bio": string | null,"business_info": NonNullable<Json>,"contact_policy": Database["public"]['Enums']["contact_policy"],"contact_sources": NonNullable<Json>,"contacts_synced_at": string | null,"created_at": string,"discoverable": boolean,"display_name": string,"group_add_policy": string,"guest": boolean,"handle": string,"id": string,"owner_id": string,"recommendations_ok": boolean,"type": Database["public"]['Enums']["agent_type"],"verified_domain": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appearance"?: NonNullable<Json>,"avatar"?: string,"bio"?: string | null,"business_info"?: NonNullable<Json>,"contact_policy"?: Database["public"]['Enums']["contact_policy"],"contact_sources"?: NonNullable<Json>,"contacts_synced_at"?: string | null,"created_at"?: string,"discoverable"?: boolean,"display_name": string,"group_add_policy"?: string,"guest"?: boolean,"handle": string,"id"?: string,"owner_id": string,"recommendations_ok"?: boolean,"type"?: Database["public"]['Enums']["agent_type"],"verified_domain"?: string | null
                  }
                  Update: {
                    "appearance"?: NonNullable<Json>,"avatar"?: string,"bio"?: string | null,"business_info"?: NonNullable<Json>,"contact_policy"?: Database["public"]['Enums']["contact_policy"],"contact_sources"?: NonNullable<Json>,"contacts_synced_at"?: string | null,"created_at"?: string,"discoverable"?: boolean,"display_name"?: string,"group_add_policy"?: string,"guest"?: boolean,"handle"?: string,"id"?: string,"owner_id"?: string,"recommendations_ok"?: boolean,"type"?: Database["public"]['Enums']["agent_type"],"verified_domain"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"business_managers": {
                  Row: {
                    "business_agent_id": string,"created_at": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_agent_id": string,"created_at"?: string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "business_agent_id"?: string,"created_at"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_managers_business_agent_id_fkey"
      columns: ["business_agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"business_placements": {
                  Row: {
                    "added_by": string | null,"business_agent_id": string,"community_id": string | null,"conversation_id": string | null,"created_at": string,"id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"business_agent_id": string,"community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"id"?: string,"status"?: string
                  }
                  Update: {
                    "added_by"?: string | null,"business_agent_id"?: string,"community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_placements_business_agent_id_fkey"
      columns: ["business_agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "business_placements_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "business_placements_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"business_sites": {
                  Row: {
                    "agent_id": string,"created_at": string,"domain": string,"error": string | null,"hidden": (string)[],"last_read_at": string | null,"learned": NonNullable<Json>,"live_at": string | null,"pages_found": number,"pages_read": number,"progress": NonNullable<Json>,"reading_started_at": string | null,"status": string,"url": string,"verify_token": string,"warning": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"created_at"?: string,"domain": string,"error"?: string | null,"hidden"?: (string)[],"last_read_at"?: string | null,"learned"?: NonNullable<Json>,"live_at"?: string | null,"pages_found"?: number,"pages_read"?: number,"progress"?: NonNullable<Json>,"reading_started_at"?: string | null,"status"?: string,"url": string,"verify_token"?: string,"warning"?: string | null
                  }
                  Update: {
                    "agent_id"?: string,"created_at"?: string,"domain"?: string,"error"?: string | null,"hidden"?: (string)[],"last_read_at"?: string | null,"learned"?: NonNullable<Json>,"live_at"?: string | null,"pages_found"?: number,"pages_read"?: number,"progress"?: NonNullable<Json>,"reading_started_at"?: string | null,"status"?: string,"url"?: string,"verify_token"?: string,"warning"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_sites_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: true
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"business_sources": {
                  Row: {
                    "agent_id": string,"content": string | null,"content_hash": string | null,"created_at": string,"error": string | null,"id": string,"kind": string | null,"last_read_at": string | null,"origin": string,"status": string,"title": string | null,"url": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"content"?: string | null,"content_hash"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind"?: string | null,"last_read_at"?: string | null,"origin"?: string,"status"?: string,"title"?: string | null,"url": string,"visibility"?: string
                  }
                  Update: {
                    "agent_id"?: string,"content"?: string | null,"content_hash"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind"?: string | null,"last_read_at"?: string | null,"origin"?: string,"status"?: string,"title"?: string | null,"url"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_sources_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"communities": {
                  Row: {
                    "avatar": string,"created_at": string,"description": string | null,"digest_sent_at": string | null,"house_rules": (string)[],"id": string,"language": string | null,"mods_nudged_at": string | null,"name": string,"owner_id": string | null,"rules": string | null,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar"?: string,"created_at"?: string,"description"?: string | null,"digest_sent_at"?: string | null,"house_rules"?: (string)[],"id"?: string,"language"?: string | null,"mods_nudged_at"?: string | null,"name": string,"owner_id"?: string | null,"rules"?: string | null,"visibility"?: string
                  }
                  Update: {
                    "avatar"?: string,"created_at"?: string,"description"?: string | null,"digest_sent_at"?: string | null,"house_rules"?: (string)[],"id"?: string,"language"?: string | null,"mods_nudged_at"?: string | null,"name"?: string,"owner_id"?: string | null,"rules"?: string | null,"visibility"?: string
                  }
                  Relationships: [
                    
                  ]
                },"community_bans": {
                  Row: {
                    "banned_by": string | null,"community_id": string,"created_at": string,"reason": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "banned_by"?: string | null,"community_id": string,"created_at"?: string,"reason"?: string | null,"user_id": string
                  }
                  Update: {
                    "banned_by"?: string | null,"community_id"?: string,"created_at"?: string,"reason"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "community_bans_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    }
                  ]
                },"community_members": {
                  Row: {
                    "community_id": string,"joined_at": string,"last_seen_at": string,"muted_until": string | null,"role": string,"rules_accepted_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "community_id": string,"joined_at"?: string,"last_seen_at"?: string,"muted_until"?: string | null,"role"?: string,"rules_accepted_at"?: string,"user_id": string
                  }
                  Update: {
                    "community_id"?: string,"joined_at"?: string,"last_seen_at"?: string,"muted_until"?: string | null,"role"?: string,"rules_accepted_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "community_members_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_imports": {
                  Row: {
                    "agent_id": string,"created_at": string,"expires_at": string,"items": NonNullable<Json>,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"created_at"?: string,"expires_at": string,"items": NonNullable<Json>,"source": string
                  }
                  Update: {
                    "agent_id"?: string,"created_at"?: string,"expires_at"?: string,"items"?: NonNullable<Json>,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_imports_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: true
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
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
                },"conversation_blocks": {
                  Row: {
                    "conversation_id": string,"created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_blocks_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_members": {
                  Row: {
                    "conversation_id": string,"joined_at": string,"last_read_at": string,"muted": boolean,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"joined_at"?: string,"last_read_at"?: string,"muted"?: boolean,"role"?: string,"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"joined_at"?: string,"last_read_at"?: string,"muted"?: boolean,"role"?: string,"user_id"?: string
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
                    "approve_new_members": boolean,"avatar": string | null,"channel": string | null,"community_id": string | null,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"kind": Database["public"]['Enums']["conversation_kind"],"only_admins_edit": boolean,"only_admins_send": boolean,"target_agent": string | null,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approve_new_members"?: boolean,"avatar"?: string | null,"channel"?: string | null,"community_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["conversation_kind"],"only_admins_edit"?: boolean,"only_admins_send"?: boolean,"target_agent"?: string | null,"title"?: string | null
                  }
                  Update: {
                    "approve_new_members"?: boolean,"avatar"?: string | null,"channel"?: string | null,"community_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["conversation_kind"],"only_admins_edit"?: boolean,"only_admins_send"?: boolean,"target_agent"?: string | null,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    },{
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
                },"introductions": {
                  Row: {
                    "a_agent": string,"a_answer": string | null,"b_agent": string,"b_answer": string | null,"created_at": string,"id": string,"introducer_agent": string,"note": string | null,"status": string,"thread_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "a_agent": string,"a_answer"?: string | null,"b_agent": string,"b_answer"?: string | null,"created_at"?: string,"id"?: string,"introducer_agent": string,"note"?: string | null,"status"?: string,"thread_id"?: string | null
                  }
                  Update: {
                    "a_agent"?: string,"a_answer"?: string | null,"b_agent"?: string,"b_answer"?: string | null,"created_at"?: string,"id"?: string,"introducer_agent"?: string,"note"?: string | null,"status"?: string,"thread_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "introductions_a_agent_fkey"
      columns: ["a_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "introductions_b_agent_fkey"
      columns: ["b_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "introductions_introducer_agent_fkey"
      columns: ["introducer_agent"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "introductions_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "agent_threads"
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
                },"join_links": {
                  Row: {
                    "community_id": string | null,"conversation_id": string | null,"created_at": string,"created_by": string | null,"expires_at": string,"revoked": boolean,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"expires_at": string,"revoked"?: boolean,"token": string
                  }
                  Update: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"revoked"?: boolean,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "join_links_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "join_links_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"join_requests": {
                  Row: {
                    "community_id": string | null,"conversation_id": string | null,"created_at": string,"decided_by": string | null,"id": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"decided_by"?: string | null,"id"?: string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"decided_by"?: string | null,"id"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "join_requests_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "join_requests_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
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
                    "content": string,"conversation_id": string,"created_at": string,"id": string,"is_ai_generated": boolean,"metadata": NonNullable<Json>,"removed_at": string | null,"removed_by": string | null,"sender_agent_id": string | null,"sender_user_id": string | null,"thread_id": string | null,"visible_to": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"conversation_id": string,"created_at"?: string,"id"?: string,"is_ai_generated": boolean,"metadata"?: NonNullable<Json>,"removed_at"?: string | null,"removed_by"?: string | null,"sender_agent_id"?: string | null,"sender_user_id"?: string | null,"thread_id"?: string | null,"visible_to"?: string | null
                  }
                  Update: {
                    "content"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"is_ai_generated"?: boolean,"metadata"?: NonNullable<Json>,"removed_at"?: string | null,"removed_by"?: string | null,"sender_agent_id"?: string | null,"sender_user_id"?: string | null,"thread_id"?: string | null,"visible_to"?: string | null
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
    },{
      foreignKeyName: "messages_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "agent_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_events": {
                  Row: {
                    "action": string,"appeal_resolved_at": string | null,"appeal_resolved_by": string | null,"appeal_status": string | null,"appealed_at": string | null,"community_id": string,"confidence": number | null,"conversation_id": string | null,"created_at": string,"excerpt": string | null,"id": string,"message_id": string | null,"original_text": string | null,"reason": string | null,"user_id": string | null,"verdict": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"appeal_resolved_at"?: string | null,"appeal_resolved_by"?: string | null,"appeal_status"?: string | null,"appealed_at"?: string | null,"community_id": string,"confidence"?: number | null,"conversation_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"message_id"?: string | null,"original_text"?: string | null,"reason"?: string | null,"user_id"?: string | null,"verdict": string
                  }
                  Update: {
                    "action"?: string,"appeal_resolved_at"?: string | null,"appeal_resolved_by"?: string | null,"appeal_status"?: string | null,"appealed_at"?: string | null,"community_id"?: string,"confidence"?: number | null,"conversation_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"message_id"?: string | null,"original_text"?: string | null,"reason"?: string | null,"user_id"?: string | null,"verdict"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "moderation_events_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_events_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_events_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id"]
    }
                  ]
                },"notices": {
                  Row: {
                    "area": string,"created_at": string,"dismissed_at": string | null,"id": string,"kind": string,"link": string | null,"needs_action": boolean,"ref_id": string | null,"resolved_at": string | null,"seen_at": string | null,"text": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area": string,"created_at"?: string,"dismissed_at"?: string | null,"id"?: string,"kind"?: string,"link"?: string | null,"needs_action"?: boolean,"ref_id"?: string | null,"resolved_at"?: string | null,"seen_at"?: string | null,"text": string,"user_id": string
                  }
                  Update: {
                    "area"?: string,"created_at"?: string,"dismissed_at"?: string | null,"id"?: string,"kind"?: string,"link"?: string | null,"needs_action"?: boolean,"ref_id"?: string | null,"resolved_at"?: string | null,"seen_at"?: string | null,"text"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"phone_verifications": {
                  Row: {
                    "agent_id": string,"attempts": number,"code_hash": string,"expires_at": string,"hint": string,"phone_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"attempts"?: number,"code_hash": string,"expires_at": string,"hint": string,"phone_hash": string
                  }
                  Update: {
                    "agent_id"?: string,"attempts"?: number,"code_hash"?: string,"expires_at"?: string,"hint"?: string,"phone_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "phone_verifications_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: true
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
                },"plan_invites": {
                  Row: {
                    "created_at": string,"created_by": string,"expires_at": string,"revoked": boolean,"task_id": string,"token": string,"uses": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"expires_at": string,"revoked"?: boolean,"task_id": string,"token": string,"uses"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"expires_at"?: string,"revoked"?: boolean,"task_id"?: string,"token"?: string,"uses"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_invites_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_invites_task_id_fkey"
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
                },"reports": {
                  Row: {
                    "community_id": string | null,"conversation_id": string | null,"created_at": string,"excerpt": string | null,"id": string,"message_id": string | null,"reason": string,"reporter_id": string | null,"resolved_by": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"message_id"?: string | null,"reason": string,"reporter_id"?: string | null,"resolved_by"?: string | null,"status"?: string
                  }
                  Update: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"message_id"?: string | null,"reason"?: string,"reporter_id"?: string | null,"resolved_by"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_community_id_fkey"
      columns: ["community_id"]
isOneToOne: false
      referencedRelation: "communities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id"]
    }
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
            "action_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "communities": number,"contacts": number,"groups": number
            }[]
                           },
"add_plan_participant":
{ Args: { "p_handle": string,"p_max": number,"p_task": string }; Returns: string
                           },
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
"community_member_counts":
{ Args: { "p_ids": (string)[] }; Returns: {
              "community_id": string,"members": number
            }[]
                           },
"community_role":
{ Args: { "c": string }; Returns: string
                           },
"confirmed_users_by_email":
{ Args: { "p_emails": (string)[] }; Returns: {
              "email": string,"user_id": string
            }[]
                           },
"conversation_role":
{ Args: { "conv": string }; Returns: string
                           },
"identity_badge":
{ Args: { "p_user": string }; Returns: number
                           },
"increment_invite_uses":
{ Args: { "p_token": string }; Returns: undefined
                           },
"is_community_member":
{ Args: { "c": string }; Returns: boolean
                           },
"is_conversation_member":
{ Args: { "conv": string }; Returns: boolean
                           },
"mark_conversation_read":
{ Args: { "p_conversation": string }; Returns: undefined
                           },
"mark_notices_seen":
{ Args: { "p_area": string }; Returns: undefined
                           },
"mark_thread_read":
{ Args: { "p_thread": string }; Returns: undefined
                           },
"my_agent_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_agent_threads":
{ Args: Record<PropertyKey, never>; Returns: {
              "id": string,"kind": string,"last_activity_at": string,"preview": string,"task_id": string,"task_status": string,"title": string,"unread": number
            }[]
                           },
"notice_is_muted":
{ Args: { "p_area": string,"p_ref": string,"p_user": string }; Returns: boolean
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"retry_after_seconds": number
            }[]
                           },
"renew_task_lease":
{ Args: { "p_lease_seconds": number,"p_task": string,"p_token": string }; Returns: boolean
                           },
"task_thread_title":
{ Args: { "p_task": string }; Returns: string
                           },
"unread_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "conversation_id": string,"muted": boolean,"unread": number
            }[]
                           }
          }
          Enums: {
            "agent_type": "personal"|"business","contact_policy": "contacts_only"|"anyone"|"nobody","contact_status": "pending"|"accepted"|"blocked","conversation_kind": "dm"|"group"|"my_agent"|"agent_chat"|"channel","disclosure_level": "private"|"contacts","exchange_status": "pending"|"completed"|"refused"|"failed"|"waiting_human","proposal_status": "pending"|"accepted"|"rejected","task_status": "awaiting_approval"|"running"|"proposal_ready"|"accepted"|"rejected"|"cancelled"|"failed"|"waiting"|"completed"
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
            "agent_type": ["personal", "business"],"contact_policy": ["contacts_only", "anyone", "nobody"],"contact_status": ["pending", "accepted", "blocked"],"conversation_kind": ["dm", "group", "my_agent", "agent_chat", "channel"],"disclosure_level": ["private", "contacts"],"exchange_status": ["pending", "completed", "refused", "failed", "waiting_human"],"proposal_status": ["pending", "accepted", "rejected"],"task_status": ["awaiting_approval", "running", "proposal_ready", "accepted", "rejected", "cancelled", "failed", "waiting", "completed"]
          }
        }
} as const
