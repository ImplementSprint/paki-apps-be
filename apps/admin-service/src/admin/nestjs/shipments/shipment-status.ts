export const SHIPMENT_STATUSES = ['In Transit', 'Pending', 'Delivered', 'Cancelled'] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export function getShipmentEtaAfterStatusChange(status: ShipmentStatus, currentEta: string) {
  if (status === 'Delivered') {
    return 'Delivered';
  }

  if (status === 'Cancelled') {
    return 'Cancelled';
  }

  if (status === 'Pending') {
    return 'N/A';
  }

  return currentEta === 'Delivered' || currentEta === 'Cancelled' || currentEta === 'N/A' ? '15 mins' : currentEta;
}
