import type { Timestamp } from 'firebase/firestore';
export type Currency = 'CAD' | 'USD' | 'CNY';
export type SplitMethod = 'equal' | 'exact' | 'percentage';
export type Kind = 'expense' | 'loan' | 'repayment';
export type Action = 'create' | 'edit' | 'delete' | 'restore' | 'settle';
export interface Member {
  name: string;
}
export interface Ledger {
  id: string;
  name: string;
  currency: Currency;
  ownerId: string;
  memberIds: string[];
  members: Record<string, Member>;
  createdAt: Timestamp;
  revision: number;
  joinToken: string;
  hasRecords: boolean;
}
export interface FinancialData {
  kind: Kind;
  description: string;
  amount: number;
  currency: Currency;
  date: string;
  payerId: string;
  receiverId: string;
  participants: string[];
  shares: Record<string, number>;
  weights: Record<string, number>;
  splitMethod: SplitMethod;
  notes: string;
  deleted: boolean;
  settlementKey: string;
}
export interface FinancialRecord {
  id: string;
  ledgerId: string;
  data: FinancialData;
  version: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedBy: string;
  updatedAt: Timestamp;
  action: Action;
}
export interface AuditEvent {
  id: string;
  ledgerId: string;
  recordId: string;
  version: number;
  actorId: string;
  at: Timestamp;
  action: Action;
  before: FinancialData | null;
  after: FinancialData;
}
export interface Invitation {
  ledgerId: string;
  ledgerName: string;
  currency: Currency;
  email: string;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  usedBy: string | null;
  usedAt: Timestamp | null;
  revoked: boolean;
}
export interface Settlement {
  payerId: string;
  receiverId: string;
  amount: number;
}
