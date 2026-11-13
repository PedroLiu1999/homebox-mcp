export interface HomeboxStatus {
  version?: string;
  buildTime?: string;
  commit?: string;
  title?: string;
  message?: string;
  health?: boolean;
}

export interface HomeboxUser {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  groupId?: string;
  groupName?: string;
  isOwner?: boolean;
  isSuperuser?: boolean;
}

export interface HomeboxUserSelfResponse {
  item?: HomeboxUser;
  id?: string;
  name?: string;
  username?: string;
  email?: string;
  groupId?: string;
}

export interface HomeboxGroup {
  id: string;
  name: string;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type HomeboxGroupListResponse =
  | { items: HomeboxGroup[] }
  | HomeboxGroup[];

export interface HomeboxCustomFieldInput {
  id?: string;
  name: string;
  type: string;
  textValue?: string;
  numberValue?: number;
  booleanValue?: boolean;
  timeValue?: string;
}

export type HomeboxCustomField = HomeboxCustomFieldInput;

export interface HomeboxAttachment {
  id: string;
  type?: string;
  mimeType?: string;
  path?: string;
  primary?: boolean;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HomeboxTag {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HomeboxTagUpsertRequest {
  name: string;
  description?: string;
  color?: string;
}

export interface HomeboxEntitySummary {
  id: string;
  name: string;
  description?: string;
  quantity?: number;
  entityType?: string;
  assetId?: string;
  archived?: boolean;
  location?: { id: string; name: string };
  labels?: HomeboxTag[];
  parent?: { id: string; name: string };
  thumbnailId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HomeboxEntity extends HomeboxEntitySummary {
  locationId?: string;
  parentId?: string;
  labelIds?: string[];
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  purchasePrice?: number;
  purchaseFrom?: string;
  purchaseTime?: string;
  warrantyExpires?: string;
  warrantyDetails?: string;
  lifetimeWarranty?: boolean;
  insured?: boolean;
  notes?: string;
  fields?: HomeboxCustomField[];
  attachments?: HomeboxAttachment[];
}

export interface HomeboxEntityListParams {
  q?: string;
  page?: number;
  pageSize?: number;
  labels?: string[];
  locations?: string[];
  parentIds?: string[];
  entityType?: string;
  assetId?: string;
  orderBy?: string;
  includeArchived?: boolean;
  tenant?: string;
}

export interface HomeboxEntityListResponse {
  items: HomeboxEntitySummary[];
  page?: number;
  pageSize?: number;
  total?: number;
}

export interface HomeboxEntityCreateRequest {
  name: string;
  description?: string;
  quantity?: number;
  locationId?: string;
  parentId?: string;
  labelIds?: string[];
  entityType?: string;
  assetId?: string;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  purchasePrice?: number;
  purchaseFrom?: string;
  purchaseTime?: string;
  warrantyExpires?: string;
  warrantyDetails?: string;
  lifetimeWarranty?: boolean;
  insured?: boolean;
  archived?: boolean;
  notes?: string;
  fields?: HomeboxCustomFieldInput[];
}

export type HomeboxEntityUpdateRequest = HomeboxEntityCreateRequest;

export type HomeboxEntityPatchRequest = Partial<HomeboxEntityCreateRequest>;

export interface HomeboxEntityTreeNode {
  id: string;
  name: string;
  description?: string;
  type?: string;
  children?: HomeboxEntityTreeNode[];
  items?: HomeboxEntitySummary[];
}

export interface HomeboxEntityPathNode {
  id: string;
  name: string;
  type?: string;
}

export interface HomeboxFieldValueEntry {
  name?: string;
  values?: Array<string | number | boolean>;
}

export interface HomeboxEntityType {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HomeboxEntityTypeUpsertRequest {
  name: string;
  description?: string;
  icon?: string;
}

export interface HomeboxTemplate {
  id: string;
  name: string;
  description?: string;
  notes?: string;
  manufacturer?: string;
  modelNumber?: string;
  defaultLocationId?: string;
  defaultLabelIds?: string[];
  fields?: HomeboxCustomField[];
  includePurchaseInformation?: boolean;
  includeWarrantyInformation?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface HomeboxTemplateUpsertRequest {
  name: string;
  description?: string;
  notes?: string;
  manufacturer?: string;
  modelNumber?: string;
  defaultLocationId?: string;
  defaultLabelIds?: string[];
  fields?: HomeboxCustomFieldInput[];
  includePurchaseInformation?: boolean;
  includeWarrantyInformation?: boolean;
}

export interface HomeboxCreateItemFromTemplateRequest {
  name?: string;
  description?: string;
  quantity?: number;
  locationId?: string;
  labelIds?: string[];
  fields?: HomeboxCustomFieldInput[];
}

export type HomeboxMaintenanceStatus = "scheduled" | "completed" | "both";

export interface HomeboxMaintenanceEntry {
  id: string;
  itemId?: string;
  name: string;
  description?: string;
  scheduledDate?: string;
  completedDate?: string;
  cost?: string | number;
}

export interface HomeboxMaintenanceUpsertRequest {
  name: string;
  description?: string;
  scheduledDate?: string;
  completedDate?: string;
  cost?: string | number;
}

export interface HomeboxBillOfMaterialsItem {
  id: string;
  name: string;
  quantity?: number;
  purchasePrice?: number;
  totalValue?: number;
  location?: { id: string; name: string };
}

export type HomeboxBillOfMaterialsReport =
  | {
      items?: HomeboxBillOfMaterialsItem[];
      totalItems?: number;
      totalValue?: number;
    }
  | HomeboxBillOfMaterialsItem[];

export interface HomeboxGroupStatistics {
  totalItems?: number;
  totalLocations?: number;
  totalLabels?: number;
  totalUsers?: number;
  totalItemPrice?: number;
  totalWithWarranty?: number;
}
