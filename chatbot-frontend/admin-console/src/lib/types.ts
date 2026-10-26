export interface Totals {
  messages: number; sessions: number; answered: number; llm_answers: number; cache_hits: number;
  not_answered: number; smalltalk: number; blocked: number; errors: number; answer_rate: number;
  avg_confidence: number; avg_latency_ms: number; cost_usd: number; input_tokens: number;
  output_tokens: number; cost_per_llm_answer_usd: number;
}
export interface DailyPoint { day: string; messages: number; answered: number; not_answered: number; cost_usd: number }
export interface ModelCost { model: string; answers: number; input_tokens: number; output_tokens: number; cost_usd: number; priced: boolean }
export interface Stats { period_days: number; totals: Totals; by_outcome: Record<string, number>; daily: DailyPoint[]; by_model: ModelCost[]; cost_note?: string }
export interface Conversation {
  id: string; created_at: string; session: string; outcome: string; question: string; answer: string;
  confidence: number | null; model: string | null; tier: string | null; cost_usd: number | null; latency_ms: number | null;
}
export interface ConversationPage { total: number; limit: number; offset: number; items: Conversation[] }
export interface Pricing { unit: string; models: { model: string; input: number; output: number }[]; how_to_change?: string }
export interface Usage { day: string; llm_messages: number; estimated_tokens: number; message_cap: number; token_cap: number }
export interface DocumentRow { id: string; title: string; url: string | null; category: string | null; chunks: number; created_at: string | null }
export interface IngestResult { document_id: string; title: string; chunks: number; replaced: boolean }
export interface Health { status: string; database: boolean; redis: boolean }
