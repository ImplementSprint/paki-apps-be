import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { SupabaseService } from '../supabase/supabase.service';
import { ApicenterService } from '../apicenter/apicenter.service';
import { ListShipmentsDto } from './dto/list-shipments.dto';
import { UpdateShipmentStatusDto } from './dto/update-shipment-status.dto';
import type { Shipment, ShipmentStatusHistoryItem } from './interfaces/shipment.interface';
import type { ShipmentStatus } from './shipment-status';

interface ParcelDriverJobRow {
  completed_at: string | null;
  created_at: string | null;
  customer_name: string;
  customer_phone: string | null;
  delivered_at: string | null;
  distance_text: string | null;
  driver_user_id: string | null;
  dropoff_address: string;
  earnings_amount: number | string;
  id: string;
  job_number: string;
  package_description: string | null;
  package_size: string;
  parcel_draft_id: string | null;
  parcel_status: string | null;
  pickup_address: string;
  status: string;
  time_limit_text: string | null;
  updated_at: string | null;
}

interface ParcelDriverJobEventRow {
  created_at: string | null;
  driver_user_id: string | null;
  event_type: string;
  id: string;
  job_id: string | null;
  payload: Record<string, unknown> | null;
}

interface AccountProfileRow {
  full_name: string | null;
  id: string;
}

type ParcelStatusUpdate = {
  completed_at?: string | null;
  delivered_at?: string | null;
  parcel_status: string;
  status: string;
  updated_at: string;
};

const SHIPMENT_SOURCE_STATUSES = ['pending', 'accepted', 'in-progress', 'completed', 'cancelled'];

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly apicenterService: ApicenterService,
  ) {}

  async findAll(query: ListShipmentsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const shipments = await this.loadShipments(query.status);
    const filtered = this.applyFilters(shipments, query);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startIndex = (page - 1) * limit;
    const data = filtered.slice(startIndex, startIndex + limit);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async findOne(id: string) {
    const rows = await this.supabaseService.select<ParcelDriverJobRow>('parcel.driver_jobs', {
      select: '*',
      job_number: `eq.${id}`,
      limit: 1,
    });
    const row = rows[0];

    if (!row) {
      throw new NotFoundException(`Shipment ${id} was not found.`);
    }

    const driverNames = await this.loadDriverNames([row]);
    const history = await this.loadStatusHistory(row.id);

    return this.toShipment(row, history, driverNames[row.driver_user_id ?? '']);
  }

  async getDrivers() {
    const rows = await this.supabaseService.select<Pick<ParcelDriverJobRow, 'driver_user_id'>>('parcel.driver_jobs', {
      select: 'driver_user_id',
      status: `in.(${SHIPMENT_SOURCE_STATUSES.join(',')})`,
    });
    const driverNames = await this.loadDriverNames(rows);

    return Array.from(new Set(Object.values(driverNames))).sort();
  }

  async updateStatus(id: string, dto: UpdateShipmentStatusDto) {
    const rows = await this.supabaseService.select<ParcelDriverJobRow>('parcel.driver_jobs', {
      select: '*',
      job_number: `eq.${id}`,
      limit: 1,
    });
    const job = rows[0];

    if (!job) {
      throw new NotFoundException(`Shipment ${id} was not found.`);
    }

    const now = new Date().toISOString();
    const update = this.toParcelStatusUpdate(dto.status, now);

    await this.supabaseService.update<ParcelDriverJobRow>(
      'parcel.driver_jobs',
      { id: `eq.${job.id}` },
      update as unknown as Record<string, unknown>,
    );
    await this.supabaseService.insert<ParcelDriverJobEventRow>('parcel.driver_job_events', {
      id: randomUUID(),
      job_id: job.id,
      driver_user_id: job.driver_user_id,
      event_type: 'admin_status_updated',
      payload: {
        fromStatus: job.status,
        fromParcelStatus: job.parcel_status,
        nextJobStatus: update.status,
        parcelStatus: update.parcel_status,
        reason: dto.reason.trim(),
        updatedBy: dto.updatedBy?.trim() || 'PakiShip Admin',
      },
      created_at: now,
    });

    // Governed Kafka event dispatch through APICenter
    await this.apicenterService.publishTribeEvent({
      sourceServiceId: 'pakiship-admin',
      key: job.id,
      eventType: 'shipment.status_updated',
      payload: {
        shipmentId: job.id,
        jobNumber: job.job_number,
        fromStatus: job.status,
        toStatus: update.status,
        fromParcelStatus: job.parcel_status,
        toParcelStatus: update.parcel_status,
        reason: dto.reason.trim(),
        updatedBy: dto.updatedBy?.trim() || 'PakiShip Admin',
        occurredAt: now,
      },
    });

    return this.findOne(id);

  }

  private async loadShipments(status?: ShipmentStatus | 'All') {
    const rows = await this.supabaseService.select<ParcelDriverJobRow>('parcel.driver_jobs', {
      select: '*',
      status: this.toSourceStatusFilter(status),
      order: 'created_at.desc',
    });
    const historyRows = await this.supabaseService.select<ParcelDriverJobEventRow>('parcel.driver_job_events', {
      select: '*',
      order: 'created_at.asc',
    });
    const historyByJob = historyRows.reduce<Record<string, ShipmentStatusHistoryItem[]>>((history, row) => {
      if (!row.job_id) {
        return history;
      }

      history[row.job_id] = [...(history[row.job_id] ?? []), this.toHistoryItem(row)];

      return history;
    }, {});
    const driverNames = await this.loadDriverNames(rows);

    return rows.map((row) => this.toShipment(row, historyByJob[row.id] ?? [], driverNames[row.driver_user_id ?? '']));
  }

  private async loadStatusHistory(jobId: string) {
    const rows = await this.supabaseService.select<ParcelDriverJobEventRow>('parcel.driver_job_events', {
      select: '*',
      job_id: `eq.${jobId}`,
      order: 'created_at.asc',
    });

    return rows.map((row) => this.toHistoryItem(row));
  }

  private async loadDriverNames(rows: Array<{ driver_user_id: string | null }>) {
    const driverIds = Array.from(new Set(rows.map((row) => row.driver_user_id).filter(Boolean))) as string[];

    if (driverIds.length === 0) {
      return {};
    }

    const profiles = await this.supabaseService.select<AccountProfileRow>('account.profiles', {
      select: 'id,full_name',
      id: `in.(${driverIds.join(',')})`,
    });

    return profiles.reduce<Record<string, string>>((drivers, profile) => {
      drivers[profile.id] = profile.full_name || profile.id;

      return drivers;
    }, {});
  }

  private toShipment(row: ParcelDriverJobRow, statusHistory: ShipmentStatusHistoryItem[], driverName?: string): Shipment {
    return {
      amount: this.formatCurrency(row.earnings_amount),
      date: this.formatDate(row.completed_at ?? row.delivered_at ?? row.created_at),
      destination: row.dropoff_address,
      driver: driverName ?? (row.driver_user_id ? row.driver_user_id : 'Unassigned'),
      eta: this.toEta(row),
      id: row.job_number,
      location: row.pickup_address,
      quantity: row.package_size || '1 Parcel',
      receiver: row.customer_name,
      sender: row.customer_name,
      status: this.toShipmentStatus(row.status, row.parcel_status),
      store: row.package_description || 'PakiShip Parcel',
      statusHistory,
    };
  }

  private toHistoryItem(row: ParcelDriverJobEventRow): ShipmentStatusHistoryItem {
    const payload = row.payload ?? {};
    const nextStatus = this.toShipmentStatus(
      this.getStringPayload(payload, 'nextJobStatus') ?? this.getStringPayload(payload, 'status') ?? '',
      this.getStringPayload(payload, 'parcelStatus'),
    );
    const fromStatus = this.toShipmentStatus(
      this.getStringPayload(payload, 'fromStatus') ?? '',
      this.getStringPayload(payload, 'fromParcelStatus'),
    );

    return {
      id: row.id,
      fromStatus,
      reason: this.getStringPayload(payload, 'reason') ?? row.event_type.replace(/_/g, ' '),
      timestamp: row.created_at ?? '',
      toStatus: nextStatus,
      updatedBy: this.getStringPayload(payload, 'updatedBy') ?? 'PakiShip System',
    };
  }

  private toSourceStatusFilter(status?: ShipmentStatus | 'All') {
    if (status === 'Delivered') {
      return 'eq.completed';
    }

    if (status === 'In Transit') {
      return 'eq.in-progress';
    }

    if (status === 'Pending') {
      return 'in.(pending,accepted)';
    }

    if (status === 'Cancelled') {
      return 'eq.cancelled';
    }

    return `in.(${SHIPMENT_SOURCE_STATUSES.join(',')})`;
  }

  private toShipmentStatus(status: string | null, parcelStatus?: string | null): ShipmentStatus {
    const normalizedStatus = (status ?? '').toLowerCase();
    const normalizedParcelStatus = (parcelStatus ?? '').toLowerCase();

    if (normalizedStatus === 'completed' || normalizedParcelStatus === 'delivered') {
      return 'Delivered';
    }

    if (normalizedStatus === 'cancelled' || normalizedParcelStatus === 'cancelled') {
      return 'Cancelled';
    }

    if (normalizedStatus === 'pending' || normalizedStatus === 'accepted') {
      return 'Pending';
    }

    return 'In Transit';
  }

  private toParcelStatusUpdate(status: ShipmentStatus, timestamp: string): ParcelStatusUpdate {
    if (status === 'Delivered') {
      return {
        status: 'completed',
        parcel_status: 'delivered',
        delivered_at: timestamp,
        completed_at: timestamp,
        updated_at: timestamp,
      };
    }

    if (status === 'Cancelled') {
      return {
        status: 'cancelled',
        parcel_status: 'cancelled',
        updated_at: timestamp,
      };
    }

    if (status === 'Pending') {
      return {
        status: 'pending',
        parcel_status: 'pending',
        updated_at: timestamp,
      };
    }

    return {
      status: 'in-progress',
      parcel_status: 'out-for-delivery',
      updated_at: timestamp,
    };
  }

  private toEta(row: ParcelDriverJobRow) {
    const status = this.toShipmentStatus(row.status, row.parcel_status);

    if (status === 'Delivered') {
      return 'Delivered';
    }

    if (status === 'Cancelled') {
      return 'Cancelled';
    }

    if (row.time_limit_text) {
      return row.time_limit_text;
    }

    return row.distance_text || 'In progress';
  }

  private formatCurrency(value: number | string) {
    const amount = Number(value);

    if (Number.isNaN(amount)) {
      return String(value);
    }

    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  private formatDate(value: string | null) {
    if (!value) {
      return '';
    }

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  }

  private getStringPayload(payload: Record<string, unknown>, key: string) {
    const value = payload[key];

    return typeof value === 'string' ? value : undefined;
  }

  private applyFilters(shipments: Shipment[], query: ListShipmentsDto) {
    const search = query.search?.trim().toLowerCase() ?? '';
    const status = query.status && query.status !== 'All' ? query.status : null;
    const driver = query.driver && query.driver !== 'All Drivers' ? query.driver : null;
    const startDate = this.parseFilterDate(query.startDate);
    const endDate = this.parseFilterDate(query.endDate);
    const rangeStart = startDate && endDate && startDate > endDate ? endDate : startDate;
    const rangeEnd = startDate && endDate && startDate > endDate ? startDate : endDate;

    return shipments.filter((shipment) => {
      const shipmentDate = this.parseShipmentDate(shipment.date);
      const matchesSearch =
        !search ||
        shipment.id.toLowerCase().includes(search) ||
        shipment.sender.toLowerCase().includes(search) ||
        shipment.receiver.toLowerCase().includes(search) ||
        shipment.store.toLowerCase().includes(search);
      const matchesStatus = !status || shipment.status === status;
      const matchesDriver = !driver || shipment.driver === driver;
      const matchesDateRange =
        shipmentDate !== null &&
        (rangeStart === null || shipmentDate >= rangeStart) &&
        (rangeEnd === null || shipmentDate <= rangeEnd);

      return matchesSearch && matchesStatus && matchesDriver && matchesDateRange;
    });
  }

  private parseFilterDate(value?: string) {
    if (!value) {
      return null;
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private parseShipmentDate(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
}
