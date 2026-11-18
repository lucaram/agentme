
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type BusinessTeamTable<Row, Required extends keyof Row> = { Row: Row; Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>; Update: Partial<Row>; Relationships: [] };

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
            identity_appearance: BusinessTeamTable<{ user_id: string; agent_id: string; appearance: Json }, "user_id" | "agent_id" | "appearance">,
            profile_avatar_assets: BusinessTeamTable<{ id: string; agent_id: string; path: string; created_at: string }, "id" | "agent_id" | "path">,
            business_page_covers: BusinessTeamTable<{ agent_id: string; id: string; path: string; created_at: string }, "agent_id" | "id" | "path">,
            profile_avatar_deletions: BusinessTeamTable<{ path: string; created_at: string }, "path">,
            business_team_settings: BusinessTeamTable<{ business_agent_id: string; default_owner: string | null; tracking_since: string }, "business_agent_id">,
            business_team_history: BusinessTeamTable<{ id: string; business_agent_id: string; staff_id: string; supervisor_id: string | null; staff_name: string; supervisor_name: string | null; started_at: string; ended_at: string | null }, "business_agent_id" | "staff_id" | "staff_name">,
            business_team_transfers: BusinessTeamTable<{ id: string; business_agent_id: string; staff_id: string; from_supervisor: string; to_supervisor: string; requested_by: string; staff_name: string; from_name: string; to_name: string; requester_name: string; status: string; created_at: string; expires_at: string; decided_at: string | null; decided_by: string | null }, "business_agent_id" | "staff_id" | "from_supervisor" | "to_supervisor" | "requested_by" | "staff_name" | "from_name" | "to_name" | "requester_name">,
            business_work_notices: BusinessTeamTable<{ id: string; business_agent_id: string; recipient_id: string; kind: string; text: string; transfer_id: string | null; created_at: string; seen_at: string | null }, "business_agent_id" | "recipient_id" | "kind" | "text">,
            business_work_events: BusinessTeamTable<{ id: string; business_agent_id: string; kind: string; source_key: string; inbox_id: string | null; actor_id: string | null; actor_name: string; actor_handle: string | null; actor_role: string | null; supervisor_id: string | null; supervisor_name: string | null; supervisor_handle: string | null; occurred_at: string; received_at: string | null }, "business_agent_id" | "kind" | "source_key" | "actor_name" | "occurred_at">,
            "identity_notification_versions": {
              Row: { user_id: string; revision: number }
              Insert: { user_id: string; revision?: number }
              Update: { revision?: number }
              Relationships: []
            },
            "managed_identity_sessions": {
              Row: { session_id: string; business_user: string; person_user: string; created_at: string }
              Insert: { session_id: string; business_user: string; person_user: string; created_at?: string }
              Update: { person_user?: string }
              Relationships: []
            },
            "account_access_versions": {
              Row: { user_id: string; revision: number }
              Insert: { user_id: string; revision?: number }
              Update: { revision?: number }
              Relationships: []
            },
            "message_mentions": {
              Row: { message_id: string; conversation_id: string; user_id: string; agent_id: string; handle: string }
              Insert: { message_id: string; conversation_id: string; user_id: string; agent_id: string; handle: string }
              Update: { handle?: string }
              Relationships: []
            },
            "mention_alerts": {
              Row: { message_id: string; user_id: string; conversation_id: string; created_at: string; seen_at: string | null; notified_at: string | null }
              Insert: { message_id: string; user_id: string; conversation_id: string; created_at?: string; seen_at?: string | null; notified_at?: string | null }
              Update: { seen_at?: string | null }
              Relationships: []
            },
            "business_staff_invites": {
              Row: { id: string; business_agent_id: string; email: string; recipient_user: string | null; role: string; token_hash: string; invited_by: string | null; status: string; created_at: string; expires_at: string; responded_at: string | null }
              Insert: { business_agent_id: string; email: string; role: string; token_hash: string; recipient_user?: string | null; invited_by?: string | null; status?: string }
              Update: { status?: string; token_hash?: string; expires_at?: string }
              Relationships: []
            },
            "business_staff_audit": {
              Row: { id: string; business_agent_id: string; actor_id: string | null; supervisor_id: string | null; actor_name: string; subject_name: string; action: string; created_at: string }
              Insert: { business_agent_id: string; actor_id?: string | null; actor_name: string; subject_name: string; action: string }
              Update: { action?: string }
              Relationships: []
            },
            "business_staff_availability": {
              Row: { business_agent_id: string; user_id: string; participating: boolean; mode: string; mode_until: string | null }
              Insert: { business_agent_id: string; user_id: string; participating?: boolean; mode?: string; mode_until?: string | null }
              Update: { participating?: boolean; mode?: string; mode_until?: string | null }
              Relationships: []
            },
            "business_answer_drafts": {
              Row: { source_inbox: string | null; id: string; business_agent_id: string; author_id: string | null; author_name: string; question: string; answer: string; status: string; reviewed_by: string | null; created_at: string; reviewed_at: string | null }
              Insert: { source_inbox?: string | null; business_agent_id: string; author_id?: string | null; author_name: string; question: string; answer: string }
              Update: { status?: string; reviewed_by?: string | null; reviewed_at?: string | null }
              Relationships: []
            },
            "business_message_authors": {
              Row: { message_id: string; business_agent_id: string; actor_id: string | null; actor_name: string; role: string; created_at: string }
              Insert: { message_id: string; business_agent_id: string; actor_id?: string | null; actor_name: string; role: string }
              Update: { role?: string }
              Relationships: []
            },
            "business_question_claims": {
              Row: { manager_assigned: boolean; inbox_id: string; business_agent_id: string; assigned_to: string | null; assigned_name: string | null; claimed_at: string | null; processing_token: string | null; processing_until: string | null; handled_by: string | null; handled_at: string | null }
              Insert: { inbox_id: string; business_agent_id: string; assigned_to?: string | null }
              Update: { assigned_to?: string | null; processing_token?: string | null; processing_until?: string | null; handled_by?: string | null; handled_at?: string | null }
              Relationships: []
            },
            "business_queue_versions": {
              Row: { agent_id: string; revision: number }
              Insert: { agent_id: string; revision?: number }
              Update: { revision?: number }
              Relationships: []
            },
            "business_work_sessions": {
              Row: { session_id: string; person_user: string; business_agent_id: string; created_at: string }
              Insert: { session_id: string; person_user: string; business_agent_id: string; created_at?: string }
              Update: { business_agent_id?: string }
              Relationships: []
            },
            "business_membership_versions": {
              Row: { user_id: string; revision: number }
              Insert: { user_id: string; revision?: number }
              Update: { revision?: number }
              Relationships: []
            },
            "presence_preferences": {
              Row: { agent_id: string; visibility: string; mode: string; mode_until: string | null; generation: string }
              Insert: { agent_id: string; visibility?: string; mode?: string; mode_until?: string | null; generation?: string }
              Update: { visibility?: string; mode?: string; mode_until?: string | null; generation?: string }
              Relationships: []
            },
            "mention_preferences": {
              Row: { user_id: string; enabled: boolean }
              Insert: { user_id: string; enabled?: boolean }
              Update: { enabled?: boolean }
              Relationships: []
            },
            "mention_versions": {
              Row: { user_id: string; revision: number }
              Insert: { user_id: string; revision?: number }
              Update: { revision?: number }
              Relationships: []
            },
            "platform_account_sanctions": {
              Row: { id: string; case_id: string | null; event_id: string | null; user_id: string | null; user_key: string; subject_name: string; actor_id: string | null; action: string; justification: string; evidence_message_id: string | null; created_at: string; expires_at: string | null; revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null }
              Insert: { id?: string; case_id?: string | null; event_id?: string | null; user_id?: string | null; user_key: string; subject_name: string; actor_id?: string | null; action: string; justification: string; evidence_message_id?: string | null; created_at?: string; expires_at?: string | null; revoked_at?: string | null; revoked_by?: string | null; revoke_reason?: string | null }
              Update: { expires_at?: string | null; revoked_at?: string | null; revoked_by?: string | null; revoke_reason?: string | null }
              Relationships: []
            },
            "platform_account_appeals": {
              Row: { id: string; sanction_id: string; user_key: string; reason: string; status: string; created_at: string; reviewed_at: string | null; reviewed_by: string | null; response: string | null }
              Insert: { id?: string; sanction_id: string; user_key: string; reason: string; status?: string; created_at?: string; reviewed_at?: string | null; reviewed_by?: string | null; response?: string | null }
              Update: { status?: string; reviewed_at?: string | null; reviewed_by?: string | null; response?: string | null }
              Relationships: []
            },
            "platform_evidence_requests": {
              Row: { id: string; case_id: string; report_id: string; requester_id: string | null; question: string; status: string; reply: string | null; evidence: Json; created_at: string; answered_at: string | null }
              Insert: { id?: string; case_id: string; report_id: string; requester_id?: string | null; question: string; status?: string; reply?: string | null; evidence?: Json; created_at?: string; answered_at?: string | null }
              Update: { status?: string; reply?: string | null; evidence?: Json; answered_at?: string | null }
              Relationships: []
            },
            "platform_operators": {
              Row: { user_id: string; enabled: boolean; granted_at: string }
              Insert: { user_id: string; enabled?: boolean; granted_at?: string }
              Update: { user_id?: string; enabled?: boolean; granted_at?: string }
              Relationships: []
            },
            "platform_staff_events": {
              Row: { id: string; actor_id: string | null; target_id: string | null; target_email: string; action: string; created_at: string }
              Insert: { id?: string; actor_id?: string | null; target_id?: string | null; target_email: string; action: string; created_at?: string }
              Update: { id?: string; actor_id?: string | null; target_id?: string | null; target_email?: string; action?: string; created_at?: string }
              Relationships: []
            },
            "platform_moderators": {
              Row: { user_id: string; enabled: boolean; granted_at: string }
              Insert: { user_id: string; enabled?: boolean; granted_at?: string }
              Update: { enabled?: boolean }
              Relationships: []
            },
            "platform_cases": {
              Row: { id: string; target_kind: string; target_key: string; group_id: string | null; community_id: string | null; source_conversation: string | null; message_id: string | null; subject_user_id: string | null; rules: string | null; title: string; description: string | null; status: string; outcome: string | null; response: string | null; revision: number; created_at: string; updated_at: string }
              Insert: { id?: string; target_kind: string; target_key: string; group_id?: string | null; community_id?: string | null; title: string; description?: string | null; status?: string; outcome?: string | null; response?: string | null; revision?: number; created_at?: string; updated_at?: string }
              Update: { status?: string; outcome?: string | null; response?: string | null; revision?: number; updated_at?: string }
              Relationships: []
            },
            "platform_reports": {
              Row: { id: string; case_id: string; reporter_id: string | null; category: string; reason: string; evidence: Json; created_at: string }
              Insert: { id?: string; case_id: string; reporter_id?: string | null; category: string; reason: string; evidence?: Json; created_at?: string }
              Update: { reason?: string }
              Relationships: []
            },
            "platform_case_events": {
              Row: { id: string; case_id: string; actor_id: string | null; action: string; public_response: string | null; internal_note: string | null; created_at: string }
              Insert: { id?: string; case_id: string; actor_id?: string | null; action: string; public_response?: string | null; internal_note?: string | null; created_at?: string }
              Update: { action?: string }
              Relationships: []
            },
            "platform_notifications": {
              Row: { id: string; user_id: string; event_id: string | null; text: string; link: string; seen_at: string | null; created_at: string }
              Insert: { id?: string; user_id: string; event_id?: string | null; text: string; link: string; seen_at?: string | null; created_at?: string }
              Update: { seen_at?: string | null }
              Relationships: []
            },
            "message_reactions": {
              Row: { message_id: string; user_id: string; reaction: string; reacted_at: string }
              Insert: { message_id: string; user_id: string; reaction: string; reacted_at?: string }
              Update: { message_id?: string; user_id?: string; reaction?: string; reacted_at?: string }
              Relationships: []
            },
            "message_reaction_versions": {
              Row: { conversation_id: string; revision: number }
              Insert: { conversation_id: string; revision?: number }
              Update: { conversation_id?: string; revision?: number }
              Relationships: []
            },
            "group_message_access": {
              Row: { conversation_id: string; user_id: string; message_id: string }
              Insert: { conversation_id: string; user_id: string; message_id: string }
              Update: { conversation_id?: string; user_id?: string; message_id?: string }
              Relationships: []
            },
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
                },"onboarding_state": {
                  Row: { "user_id": string,"dismissed_at": string | null }
                  ComputedFields: never
                  Insert: { "user_id": string,"dismissed_at"?: string | null }
                  Update: { "user_id"?: string,"dismissed_at"?: string | null }
                  Relationships: []
                },"agent_tips": {
                  Row: {
                    "agent_id": string,"created_at": string,"disclosure": Database["public"]['Enums']["disclosure_level"],"id": string,"tip": string,"topic": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"created_at"?: string,"disclosure"?: Database["public"]['Enums']["disclosure_level"],"id"?: string,"tip": string,"topic": string
                  }
                  Update: {
                    "agent_id"?: string,"created_at"?: string,"disclosure"?: Database["public"]['Enums']["disclosure_level"],"id"?: string,"tip"?: string,"topic"?: string
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
                    "appearance": NonNullable<Json>,"avatar": string,"bio": string | null,"business_info": NonNullable<Json>,"contact_policy": Database["public"]['Enums']["contact_policy"],"contact_sources": NonNullable<Json>,"contacts_synced_at": string | null,"created_at": string,"discoverable": boolean,"display_name": string,"group_add_policy": string,"guest": boolean,"handle": string,"id": string,"lookup_place": boolean,"owner_id": string,"recommendations_ok": boolean,"type": Database["public"]['Enums']["agent_type"],"verified_domain": string | null,"verified_method": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appearance"?: NonNullable<Json>,"avatar"?: string,"bio"?: string | null,"business_info"?: NonNullable<Json>,"contact_policy"?: Database["public"]['Enums']["contact_policy"],"contact_sources"?: NonNullable<Json>,"contacts_synced_at"?: string | null,"created_at"?: string,"discoverable"?: boolean,"display_name": string,"group_add_policy"?: string,"guest"?: boolean,"handle": string,"id"?: string,"lookup_place"?: boolean,"owner_id": string,"recommendations_ok"?: boolean,"type"?: Database["public"]['Enums']["agent_type"],"verified_domain"?: string | null,"verified_method"?: string | null
                  }
                  Update: {
                    "appearance"?: NonNullable<Json>,"avatar"?: string,"bio"?: string | null,"business_info"?: NonNullable<Json>,"contact_policy"?: Database["public"]['Enums']["contact_policy"],"contact_sources"?: NonNullable<Json>,"contacts_synced_at"?: string | null,"created_at"?: string,"discoverable"?: boolean,"display_name"?: string,"group_add_policy"?: string,"guest"?: boolean,"handle"?: string,"id"?: string,"lookup_place"?: boolean,"owner_id"?: string,"recommendations_ok"?: boolean,"type"?: Database["public"]['Enums']["agent_type"],"verified_domain"?: string | null,"verified_method"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"business_answer_log": {
                  Row: {
                    "agent_id": string,"created_at": string,"id": number,"step": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"created_at"?: string,"id"?: never,"step": string
                  }
                  Update: {
                    "agent_id"?: string,"created_at"?: string,"id"?: never,"step"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_answer_log_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"business_managers": {
                  Row: {
                    "business_agent_id": string,"created_at": string,"role": string,"user_id": string,"require_assignment": boolean,"require_publication_approval": boolean,"supervisor_id": string | null,"notify_departures": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "business_agent_id": string,"created_at"?: string,"role"?: string,"user_id": string,"require_assignment"?: boolean,"require_publication_approval"?: boolean,"supervisor_id"?: string | null,"notify_departures"?: boolean
                  }
                  Update: {
                    "business_agent_id"?: string,"created_at"?: string,"role"?: string,"user_id"?: string,"require_assignment"?: boolean,"require_publication_approval"?: boolean,"supervisor_id"?: string | null,"notify_departures"?: boolean
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
                },"business_site_index": {
                  Row: {
                    "agent_id": string,"fts": unknown,"indexed_at": string,"lastmod": string | null,"url": string,"words": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"fts"?: never,"indexed_at"?: string,"lastmod"?: string | null,"url": string,"words": string
                  }
                  Update: {
                    "agent_id"?: string,"fts"?: never,"indexed_at"?: string,"lastmod"?: string | null,"url"?: string,"words"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_site_index_agent_id_fkey"
      columns: ["agent_id"]
isOneToOne: false
      referencedRelation: "agents"
      referencedColumns: ["id"]
    }
                  ]
                },"receipt_preferences": {
                  Row: { user_id: string; enabled: boolean }
                  Insert: { user_id: string; enabled?: boolean }
                  Update: { enabled?: boolean }
                  Relationships: []
                },"message_views": {
                  Row: { message_id: string; user_id: string; delivered_at: string; viewed_at: string | null }
                  Insert: { message_id: string; user_id: string; delivered_at?: string; viewed_at?: string | null }
                  Update: { viewed_at?: string | null }
                  Relationships: []
                },"message_receipt_tracking": {
                  Row: { message_id: string; kind: string; agent_id: string | null; received_at: string | null; a2a_task_id: string | null; inbox_id: string | null; owner_seen_at: string | null; started_at: string }
                  Insert: { message_id: string; kind: string; agent_id?: string | null; received_at?: string | null; a2a_task_id?: string | null; inbox_id?: string | null; owner_seen_at?: string | null; started_at?: string }
                  Update: { received_at?: string | null; a2a_task_id?: string | null; inbox_id?: string | null; owner_seen_at?: string | null }
                  Relationships: []
                },"message_receipts": {
                  Row: { id: string; message_id: string; user_id: string | null; delivered_at: string | null; seen_at: string | null }
                  Insert: { id?: string; message_id: string; user_id?: string | null; delivered_at?: string | null; seen_at?: string | null }
                  Update: { delivered_at?: string | null; seen_at?: string | null }
                  Relationships: []
                },"message_receipt_versions": {
                  Row: { conversation_id: string; revision: number }
                  Insert: { conversation_id: string; revision?: number }
                  Update: { revision?: number }
                  Relationships: []
                },"chat_attachments": {
                  Row: { id:string; conversation_id:string; uploader_id:string; message_id:string|null; path:string; name:string; mime:string; kind:string; bytes:number; created_at:string; agent_notes:string|null; agent_notes_at:string|null }
                  Insert: { id?:string; conversation_id:string; uploader_id:string; message_id?:string|null; path:string; name:string; mime:string; kind:string; bytes:number; created_at?:string }
                  Update: { message_id?:string|null; agent_notes?:string|null; agent_notes_at?:string|null }
                  Relationships: []
                },"chat_attachment_gc": {
                  Row: { path:string; created_at:string }
                  Insert: { path:string; created_at?:string }
                  Update: { path?:string }
                  Relationships: []
                },"chat_upload_usage": {
                  Row: { user_id:string; day:string; bytes:number }
                  Insert: { user_id:string; day:string; bytes:number }
                  Update: { bytes?:number }
                  Relationships: []
                },"business_analytics_config": {
                  Row: { id: boolean; started_at: string }
                  Insert: { id?: boolean; started_at?: string }
                  Update: { id?: boolean; started_at?: string }
                  Relationships: []
                },"business_action_versions": {
                  Row: { agent_id: string; version: number; updated_at: string }
                  Insert: { agent_id: string; version?: number; updated_at?: string }
                  Update: { agent_id?: string; version?: number; updated_at?: string }
                  Relationships: []
                },"business_action_events": {
                  Row: { id: string; agent_id: string; kind: string; label: string; source: string; created_at: string }
                  Insert: { id: string; agent_id: string; kind: string; label: string; source: string; created_at?: string }
                  Update: { id?: string; agent_id?: string; kind?: string; label?: string; source?: string; created_at?: string }
                  Relationships: []
                },"business_sites": {
                  Row: {
                    "agent_id": string,"auto_refresh": boolean,"last_success_at": string | null,"created_at": string,"domain": string,"error": string | null,"hidden": (string)[],"lang": string | null,"last_read_at": string | null,"learned": NonNullable<Json>,"live_at": string | null,"pages_found": number,"pages_read": number,"progress": NonNullable<Json>,"reading_started_at": string | null,"search_template": string | null,"status": string,"url": string,"verify_token": string,"warning": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"auto_refresh"?: boolean,"last_success_at"?: string | null,"created_at"?: string,"domain": string,"error"?: string | null,"hidden"?: (string)[],"lang"?: string | null,"last_read_at"?: string | null,"learned"?: NonNullable<Json>,"live_at"?: string | null,"pages_found"?: number,"pages_read"?: number,"progress"?: NonNullable<Json>,"reading_started_at"?: string | null,"search_template"?: string | null,"status"?: string,"url": string,"verify_token"?: string,"warning"?: string | null
                  }
                  Update: {
                    "agent_id"?: string,"auto_refresh"?: boolean,"last_success_at"?: string | null,"created_at"?: string,"domain"?: string,"error"?: string | null,"hidden"?: (string)[],"lang"?: string | null,"last_read_at"?: string | null,"learned"?: NonNullable<Json>,"live_at"?: string | null,"pages_found"?: number,"pages_read"?: number,"progress"?: NonNullable<Json>,"reading_started_at"?: string | null,"search_template"?: string | null,"status"?: string,"url"?: string,"verify_token"?: string,"warning"?: string | null
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
                },"business_prices": {
                  Row: { id: string; agent_id: string; item: string; variant: string | null; price: number; currency: string; source_url: string | null; source_label: string | null; visibility: string; found_price: number | null; corrected: boolean; added: boolean; hidden: boolean; read_at: string | null; updated_at: string }
                  Insert: { id?: string; agent_id: string; item: string; variant?: string | null; price: number; currency?: string; source_url?: string | null; source_label?: string | null; visibility?: string; found_price?: number | null; corrected?: boolean; added?: boolean; hidden?: boolean; read_at?: string | null; updated_at?: string }
                  Update: { item?: string; variant?: string | null; price?: number; currency?: string; source_url?: string | null; source_label?: string | null; visibility?: string; found_price?: number | null; corrected?: boolean; added?: boolean; hidden?: boolean; read_at?: string | null; updated_at?: string }
                  Relationships: []
                },"business_facilities": {
                  Row: { agent_id: string; key: string; status: string; evidence: string | null; source_url: string | null; source_label: string | null; visibility: string; confirmed: boolean; updated_at: string }
                  Insert: { agent_id: string; key: string; status: string; evidence?: string | null; source_url?: string | null; source_label?: string | null; visibility?: string; confirmed?: boolean; updated_at?: string }
                  Update: { status?: string; evidence?: string | null; source_url?: string | null; source_label?: string | null; visibility?: string; confirmed?: boolean; updated_at?: string }
                  Relationships: []
                },"business_sources": {
                  Row: {
                    "agent_id": string,"content": string | null,"content_hash": string | null,"created_at": string,"error": string | null,"id": string,"kind": string | null,"last_read_at": string | null,"offerings_hash": string | null,"origin": string,"status": string,"title": string | null,"url": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"content"?: string | null,"content_hash"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind"?: string | null,"last_read_at"?: string | null,"origin"?: string,"status"?: string,"title"?: string | null,"url": string,"visibility"?: string
                  }
                  Update: {
                    "agent_id"?: string,"content"?: string | null,"content_hash"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind"?: string | null,"last_read_at"?: string | null,"offerings_hash"?: string | null,"origin"?: string,"status"?: string,"title"?: string | null,"url"?: string,"visibility"?: string
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
                  Row: { "platform_suspended": boolean, "approve_link_members": boolean,
                    "avatar": string,"created_at": string,"description": string | null,"digest_sent_at": string | null,"house_rules": (string)[],"id": string,"language": string | null,"mods_nudged_at": string | null,"name": string,"owner_id": string | null,"rules": string | null,"visibility": string
                  }
                  ComputedFields: never
                  Insert: { "platform_suspended"?: boolean, "approve_link_members"?: boolean,
                    "avatar"?: string,"created_at"?: string,"description"?: string | null,"digest_sent_at"?: string | null,"house_rules"?: (string)[],"id"?: string,"language"?: string | null,"mods_nudged_at"?: string | null,"name": string,"owner_id"?: string | null,"rules"?: string | null,"visibility"?: string
                  }
                  Update: { "platform_suspended"?: boolean, "approve_link_members"?: boolean,
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
                    "conversation_id": string,"history_from": string,"joined_at": string,"last_read_at": string,"muted": boolean,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"history_from"?: string,"joined_at"?: string,"last_read_at"?: string,"muted"?: boolean,"role"?: string,"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"history_from"?: string,"joined_at"?: string,"last_read_at"?: string,"muted"?: boolean,"role"?: string,"user_id"?: string
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
                  Row: { "platform_suspended": boolean, "share_earlier_history": boolean,
                    "approve_new_members": boolean,"avatar": string | null,"channel": string | null,"community_id": string | null,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"kind": Database["public"]['Enums']["conversation_kind"],"only_admins_edit": boolean,"only_admins_send": boolean,"target_agent": string | null,"title": string | null
                  }
                  ComputedFields: never
                  Insert: { "platform_suspended"?: boolean, "share_earlier_history"?: boolean,
                    "approve_new_members"?: boolean,"avatar"?: string | null,"channel"?: string | null,"community_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["conversation_kind"],"only_admins_edit"?: boolean,"only_admins_send"?: boolean,"target_agent"?: string | null,"title"?: string | null
                  }
                  Update: { "platform_suspended"?: boolean, "share_earlier_history"?: boolean,
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
                    "agent_id": string,"answer": Json | null,"answered_at": string | null,"created_at": string,"exchange_id": string | null,"handoff_key": string | null,"from_agent": string | null,"id": string,"kind": string,"owner_id": string,"payload": NonNullable<Json>,"status": string,"task_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"answer"?: Json | null,"answered_at"?: string | null,"created_at"?: string,"exchange_id"?: string | null,"handoff_key"?: string | null,"from_agent"?: string | null,"id"?: string,"kind"?: string,"owner_id": string,"payload": NonNullable<Json>,"status"?: string,"task_id"?: string | null
                  }
                  Update: {
                    "agent_id"?: string,"answer"?: Json | null,"answered_at"?: string | null,"created_at"?: string,"exchange_id"?: string | null,"handoff_key"?: string | null,"from_agent"?: string | null,"id"?: string,"kind"?: string,"owner_id"?: string,"payload"?: NonNullable<Json>,"status"?: string,"task_id"?: string | null
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
                    "community_id": string | null,"conversation_id": string | null,"created_at": string,"decided_by": string | null,"id": string,"status": string,"task_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"decided_by"?: string | null,"id"?: string,"status"?: string,"task_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"decided_by"?: string | null,"id"?: string,"status"?: string,"task_id"?: string | null,"user_id"?: string
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
    },{
      foreignKeyName: "join_requests_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
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
                    "deleted_at": string | null;
                    "content": string,"conversation_id": string,"created_at": string,"id": string,"is_ai_generated": boolean,"metadata": NonNullable<Json>,"removed_at": string | null,"removed_by": string | null,"reply_to": string | null,"sender_agent_id": string | null,"sender_user_id": string | null,"thread_id": string | null,"visible_to": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "deleted_at"?: string | null;
                    "content": string,"conversation_id": string,"created_at"?: string,"id"?: string,"is_ai_generated": boolean,"metadata"?: NonNullable<Json>,"removed_at"?: string | null,"removed_by"?: string | null,"reply_to"?: string | null,"sender_agent_id"?: string | null,"sender_user_id"?: string | null,"thread_id"?: string | null,"visible_to"?: string | null
                  }
                  Update: {
                    "deleted_at"?: string | null;
                    "content"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"is_ai_generated"?: boolean,"metadata"?: NonNullable<Json>,"removed_at"?: string | null,"removed_by"?: string | null,"reply_to"?: string | null,"sender_agent_id"?: string | null,"sender_user_id"?: string | null,"thread_id"?: string | null,"visible_to"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_reply_to_fkey"
      columns: ["reply_to"]
isOneToOne: false
      referencedRelation: "messages"
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
                    "action": string,"appeal_resolved_at": string | null,"appeal_resolved_by": string | null,"appeal_status": string | null,"appealed_at": string | null,"community_id": string,"confidence": number | null,"conversation_id": string | null,"created_at": string,"excerpt": string | null,"id": string,"message_id": string | null,"original_text": string | null,"reason": string | null,"text_hash": string | null,"used_at": string | null,"user_id": string | null,"verdict": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"appeal_resolved_at"?: string | null,"appeal_resolved_by"?: string | null,"appeal_status"?: string | null,"appealed_at"?: string | null,"community_id": string,"confidence"?: number | null,"conversation_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"message_id"?: string | null,"original_text"?: string | null,"reason"?: string | null,"text_hash"?: string | null,"used_at"?: string | null,"user_id"?: string | null,"verdict": string
                  }
                  Update: {
                    "action"?: string,"appeal_resolved_at"?: string | null,"appeal_resolved_by"?: string | null,"appeal_status"?: string | null,"appealed_at"?: string | null,"community_id"?: string,"confidence"?: number | null,"conversation_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"message_id"?: string | null,"original_text"?: string | null,"reason"?: string | null,"text_hash"?: string | null,"used_at"?: string | null,"user_id"?: string | null,"verdict"?: string
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
                },"plan_step_private": {
                  Row: {
                    "result": NonNullable<Json>,"step_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "result": NonNullable<Json>,"step_id": string,"updated_at"?: string
                  }
                  Update: {
                    "result"?: NonNullable<Json>,"step_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_step_private_step_id_fkey"
      columns: ["step_id"]
isOneToOne: true
      referencedRelation: "plan_steps"
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
                    evidence: Json; category: string;
                    "community_id": string | null,"conversation_id": string | null,"created_at": string,"excerpt": string | null,"id": string,"message_id": string | null,"reason": string,"reporter_id": string | null,"resolved_by": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    evidence?: Json; category?: string;
                    "community_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"message_id"?: string | null,"reason": string,"reporter_id"?: string | null,"resolved_by"?: string | null,"status"?: string
                  }
                  Update: {
                    evidence?: Json; category?: string;
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
                },"research_cache": {
                  Row: {
                    "answer": NonNullable<Json>,"expires_at": string,"key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": NonNullable<Json>,"expires_at": string,"key": string
                  }
                  Update: {
                    "answer"?: NonNullable<Json>,"expires_at"?: string,"key"?: string
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
                    "attempts": number,"conversation_id": string,"created_at": string,"error": string | null,"goal": string,"group_conversation_id": string | null,"id": string,"initiator_agent": string,"interrupted_runs": number,"lease_token": string | null,"lease_until": string | null,"owner_id": string,"parsed": NonNullable<Json>,"status": Database["public"]['Enums']["task_status"],"updated_at": string,"wake_requested": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"conversation_id": string,"created_at"?: string,"error"?: string | null,"goal": string,"group_conversation_id"?: string | null,"id"?: string,"initiator_agent": string,"interrupted_runs"?: number,"lease_token"?: string | null,"lease_until"?: string | null,"owner_id": string,"parsed"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["task_status"],"updated_at"?: string,"wake_requested"?: boolean
                  }
                  Update: {
                    "attempts"?: number,"conversation_id"?: string,"created_at"?: string,"error"?: string | null,"goal"?: string,"group_conversation_id"?: string | null,"id"?: string,"initiator_agent"?: string,"interrupted_runs"?: number,"lease_token"?: string | null,"lease_until"?: string | null,"owner_id"?: string,"parsed"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["task_status"],"updated_at"?: string,"wake_requested"?: boolean
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
            current_identity_appearance: { Args: Record<string, never>; Returns: Json },
            set_identity_appearance: { Args: { p_appearance: Json }; Returns: undefined },
            commit_profile_avatar: { Args: { p_agent: string; p_actor: string; p_preset?: string | null; p_asset?: string | null; p_path?: string | null }; Returns: string },
            queue_unused_avatar_files: { Args: Record<string, never>; Returns: undefined },
            "action_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "communities": number,"contacts": number,"groups": number
            }[]
                           },
"acknowledge_messages": { Args: { p_ids: string[]; p_seen?: boolean }; Returns: string[] },
"delete_own_message": { Args: { p_message: string }; Returns: string },
"chat_history_page": { Args: { p_conversation: string; p_thread?: string | null; p_mode?: string; p_anchor?: string | null; p_ids?: string[] }; Returns: Json },
"can_read_chat_message": { Args: { p_message: string; p_user: string }; Returns: boolean },
"invite_group_person": { Args: { p_group: string; p_inviter: string; p_agent: string }; Returns: Json },
"answer_group_invitation": { Args: { p_item: string; p_decision: string; p_actor?: string }; Returns: string | null },
"cancel_group_invitation": { Args: { p_item: string }; Returns: undefined },
"group_invite_previews": { Args: { p_ids: string[] }; Returns: Json },
"read_member_context": { Args: { p_group: string; p_user: string }; Returns: Database["public"]["Tables"]["messages"]["Row"][] },
"open_owner_requests": { Args: { p_kinds?: string[] | null; p_exclude?: string[] }; Returns: Database["public"]["Tables"]["inbox_items"]["Row"][] },
"owner_attention_count": { Args: Record<string, never>; Returns: number },
"open_group_invitation": { Args: { p_item: string }; Returns: boolean },
"prune_group_invitations": { Args: Record<string, never>; Returns: undefined },
"is_platform_moderator": { Args: Record<string, never>; Returns: boolean },
"is_platform_operator": { Args: Record<string, never>; Returns: boolean },
"platform_staff_directory": { Args: { p_offset?: number }; Returns: Json },
"set_platform_reviewer": { Args: { p_enabled: boolean; p_email?: string; p_user?: string }; Returns: Json },
"can_review_platform_target": { Args: { p_kind: string; p_target: string }; Returns: boolean },
"submit_platform_report": { Args: { p_kind: string; p_target: string; p_category: string; p_reason: string; p_evidence?: string[]; p_actor?: string; p_versions?: Json }; Returns: Json },
"submit_local_message_report": { Args: { p_message: string; p_reason: string; p_category?: string; p_evidence?: string[]; p_actor?: string; p_versions?: Json }; Returns: string },
"request_report_evidence": { Args: { p_report: string; p_revision: number; p_question: string }; Returns: string },
"answer_report_evidence": { Args: { p_request: string; p_reply: string; p_evidence?: string[]; p_versions?: Json }; Returns: undefined },
"own_evidence_requests": { Args: Record<string, never>; Returns: Json },
"review_platform_case": { Args: { p_case: string; p_revision: number; p_action: string; p_response?: string; p_note?: string; p_subject?: string; p_evidence?: string }; Returns: undefined },
"account_is_restricted": { Args: { p_user: string }; Returns: boolean },
"due_business_refreshes": { Args: { p_before: string; p_limit: number; p_site?: boolean }; Returns: { id: string }[] },
"mention_state": { Args: { p_claim?: boolean; p_known?: string[] }; Returns: Json },
"unread_mention_page": { Args: { p_before?: string | null; p_message?: string | null }; Returns: Json },
"mention_suggestions": { Args: { p_conversation: string; p_query?: string }; Returns: Json },
"account_restriction": { Args: { p_user: string }; Returns: Json },
"account_case_people": { Args: { p_case: string }; Returns: Json },
"platform_reporting_history": { Args: { p_case: string; p_subject: string; p_offset?: number }; Returns: Json },
"own_account_sanctions": { Args: { p_offset?: number }; Returns: Json },
"submit_account_appeal": { Args: { p_sanction: string; p_reason: string }; Returns: string },
"open_account_appeal_count": { Args: Record<string, never>; Returns: number },
"account_appeal_queue": { Args: { p_state?: string; p_offset?: number }; Returns: Json },
"review_account_appeal": { Args: { p_appeal: string; p_accept: boolean; p_response: string }; Returns: undefined },
"lift_account_restriction": { Args: { p_sanction: string; p_reason: string }; Returns: undefined },
"own_platform_reports": { Args: { p_report?: string | null; p_offset?: number }; Returns: Json },
"platform_case_suspended": { Args: { p_case: string }; Returns: boolean },
"platform_attention": { Args: Record<string, never>; Returns: Json },
"platform_case_queue": { Args: { p_state?: string; p_offset?: number }; Returns: Json },
"ack_platform_notifications": { Args: { p_ids: string[] }; Returns: undefined },
"space_is_suspended": { Args: { p_conversation: string }; Returns: boolean },
"set_message_reaction": { Args: { p_message: string; p_reaction?: string | null }; Returns: Json },
"get_message_reactions": { Args: { p_ids: string[] }; Returns: Json },
"get_message_reaction_details": { Args: { p_message: string; p_offset?: number; p_reaction?: string | null }; Returns: Json },
"pending_message_deliveries": { Args: Record<string, never>; Returns: Database["public"]["Tables"]["messages"]["Row"][] },
"record_agent_receipt": { Args: { p_message: string; p_agent: string; p_task?: string | null }; Returns: undefined },
"link_business_receipt": { Args: { p_inbox: string }; Returns: undefined },
"acknowledge_business_question": { Args: { p_inbox: string }; Returns: boolean },
"set_read_receipts": { Args: { p_enabled: boolean }; Returns: undefined },
"presence_channels": { Args: { p_ids: string[] }; Returns: Json },
"workspace_context": { Args: Record<string, never>; Returns: Json },
"identity_staff_badge": { Args: { p_user: string }; Returns: number },
"set_business_default_owner": { Args: { p_owner: string }; Returns: undefined },
"leave_business": { Args: { p_business: string; p_person: string; p_dry_run?: boolean }; Returns: Json },
"set_business_departure_notices": { Args: { p_enabled: boolean }; Returns: undefined },
"request_business_staff_transfer": { Args: { p_staff: string; p_target: string }; Returns: string },
"respond_business_staff_transfer": { Args: { p_transfer: string; p_decision: string }; Returns: undefined },
"business_team_state": { Args: Record<string, never>; Returns: Json },
"business_work_inbox": { Args: Record<string, never>; Returns: Json },
"acknowledge_business_work_notice": { Args: { p_notice: string }; Returns: undefined },
"business_team_dashboard_options": { Args: Record<string, never>; Returns: Json },
"business_team_dashboard": { Args: { p_days?: number; p_scope?: string; p_person?: string | null }; Returns: Json },
"business_dashboard_as_owner": { Args: { p_business: string; p_actor: string; p_days?: number }; Returns: Json },
"notification_accounts": { Args: { p_actor: string; p_current: string }; Returns: Json },
"set_business_staff_controls": { Args: { p_user: string; p_require_assignment: boolean; p_require_publication_approval: boolean }; Returns: undefined },
"review_business_answer_as": { Args: { p_business: string; p_actor: string; p_draft: string; p_approve: boolean; p_question: string; p_answer: string }; Returns: undefined },
"publish_staff_business_answer": { Args: { p_business: string; p_actor: string; p_question: string; p_answer: string; p_inbox?: string | null; p_ticket?: string | null }; Returns: string },
"notification_snapshot": { Args: { p_user: string; p_role: string | null; p_actor: string }; Returns: Json },
"search_business_staff": { Args: { p_query: string }; Returns: { id: string; name: string; handle: string; avatar: string }[] },
"issue_business_invite": { Args: { p_target: string; p_role: string; p_digest: string; p_existing?: string | null }; Returns: string },
"cancel_business_invite": { Args: { p_invite: string }; Returns: undefined },
"respond_business_invite": { Args: { p_invite: string; p_accept: boolean }; Returns: string },
"change_business_member": { Args: { p_user: string; p_role: string; p_transfer?: boolean }; Returns: undefined },
"claim_business_question": { Args: { p_item: string; p_assignee?: string | null; p_release?: boolean }; Returns: undefined },
"reserve_business_answer": { Args: { p_item: string }; Returns: string },
"set_work_participation": { Args: { p_available: boolean }; Returns: undefined },
"post_business_authored_message": { Args: { p_actor: string; p_business: string; p_conversation: string; p_content: string; p_metadata: Json; p_user: string | null; p_agent: string | null; p_visible: string | null; p_thread: string | null; p_reply: string | null }; Returns: Database["public"]["Tables"]["messages"]["Row"][] },
"suggest_business_answer": { Args: { p_question: string; p_answer: string }; Returns: string },
"review_business_answer": { Args: { p_draft: string; p_approve: boolean; p_question: string; p_answer: string }; Returns: undefined },
"business_permission": { Args: { p_permission: string }; Returns: boolean },
"presence_channel_access": { Args: { p_topic: string; p_write: boolean }; Returns: boolean },
"presence_self": { Args: Record<string, never>; Returns: Json },
"set_presence_mode": { Args: { p_mode: string; p_minutes?: number | null }; Returns: undefined },
"set_presence_visibility": { Args: { p_visibility: string }; Returns: undefined },
"get_message_receipts": { Args: { p_ids: string[]; p_details?: boolean }; Returns: Json },
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
"interrupted_runs": number,
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
"my_agent_topic_page":
{ Args: { "p_conversation": string,"p_group"?: string,"p_before"?: string | null,"p_id"?: string | null,"p_query"?: string,"p_as_of"?: string }; Returns: Json
                           },
"notice_is_muted":
{ Args: { "p_area": string,"p_ref": string,"p_user": string }; Returns: boolean
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_max": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"retry_after_seconds": number
            }[]
                           },
"patch_business_info":
{ Args: { "p_agent": string,"p_patch": Json,"p_bio"?: string }; Returns: undefined },
"business_dashboard": { Args: { "p_agent": string; "p_days"?: number }; Returns: Json },
"register_chat_attachment": { Args: { p_id:string; p_conversation:string; p_user:string; p_path:string; p_name:string; p_mime:string; p_kind:string; p_bytes:number }; Returns: undefined },
"create_chat_poll": { Args: { p_owner:string; p_agent:string; p_origin:string; p_group:string; p_thread:string|null; p_client:string; p_question:string; p_options:Json; p_voters:Json; p_caption?:string|null; p_reply?:string|null }; Returns: string },
"business_activity":
{ Args: { "p_agent": string,"p_days"?: number }; Returns: { "received": number,"automatic": number,"team_answered": number,"unanswered": number,"awaiting_team": number }[] },
"request_business_handoff":
{ Args: { "p_exchange": string,"p_caller": string }; Returns: {
              "item_id": string | null,"created": boolean,"outcome": string
            }[]
                           },
"renew_task_lease":
{ Args: { "p_lease_seconds": number,"p_task": string,"p_token": string }; Returns: boolean
                           },
"search_site_index":
{ Args: { "p_agent": string,"p_limit"?: number,"p_query": string }; Returns: {
              "lastmod": string,"url": string,"words": string
            }[]
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
