import type { EstateType } from "./models";

export type EstateOverviewFilter = "all" | "issues" | "pending" | "requests";
export type EstateOverviewSort =
  | "name"
  | "ownersCount"
  | "balance"
  | "activeIssues"
  | "pendingAmount";
export interface EstateOverviewQuery {
  page: number;
  pageSize: number;
  search: string;
  filter: EstateOverviewFilter;
  types: EstateType[];
  sort: EstateOverviewSort;
  direction: "asc" | "desc";
}
export interface EstateOverviewItem {
  id: string;
  name: string;
  address: string;
  streetNumber: string | null;
  location: string;
  type: EstateType;
  cadastralReference: string | null;
  catastroFacadeUrl: string | null;
  /** Cuándo se subió la foto de la finca (null = no hay foto propia). */
  photoUpdatedAt?: string | null;
  ownersCount: number;
  balance: number;
  activeIssues: number;
  pendingAmount: number;
  pendingRequests: number;
}
export interface EstateOverview {
  items: EstateOverviewItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  pendingLabel: "Cuotas pendientes";
  summary: { communities: number; properties: number; pendingRequests: number };
}
export interface EstateManagementSearchResult {
  kind: "community" | "owner" | "issue";
  id: string;
  label: string;
  estateId: string;
  estateName: string;
  address: string;
  issueId?: string;
}
