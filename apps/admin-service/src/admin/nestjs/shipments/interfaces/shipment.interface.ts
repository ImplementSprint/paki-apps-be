import type { ShipmentStatus } from '../shipment-status';

export interface ShipmentStatusHistoryItem {
  id: string;
  fromStatus: ShipmentStatus;
  reason: string;
  timestamp: string;
  toStatus: ShipmentStatus;
  updatedBy: string;
}

export interface Shipment {
  amount: string;
  date: string;
  destination: string;
  driver: string;
  eta: string;
  id: string;
  location: string;
  quantity: string;
  receiver: string;
  sender: string;
  status: ShipmentStatus;
  store: string;
  statusHistory: ShipmentStatusHistoryItem[];
}
