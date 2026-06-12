import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { SessionPayload } from "../common/session/session.types";
import { ParcelDraftsRepository } from "./parcel-drafts.repository";
import {
  ALLOWED_SERVICES,
  DEFAULT_ITEMS_PAGE_SIZE,
  MAX_ITEM_QUANTITY,
  MAX_ITEMS_PAGE_SIZE,
  MAX_ITEMS_PER_REQUEST,
} from "./parcel-drafts.constants";
import { CustomerNotificationsService } from "../customer-notifications/customer-notifications.service";
import { SupabaseService } from "../supabase/supabase.service";
import { GoogleMapsService } from "../google-maps/google-maps.service";

const PHONE_REGEX = /^09\d{9}$/;
const AVAILABLE_HUBS = [
  {
    id: "9c9b9999-9999-9999-9999-999999999901",
    name: "PakiShip Cubao Hub",
    address: "Aurora Blvd, Cubao, Quezon City, Metro Manila",
    distance: "Nearby",
    status: "Open",
    capacity: "100",
    latitude: 14.6219,
    longitude: 121.0511,
  },
  {
    id: "9c9b9999-9999-9999-9999-999999999902",
    name: "PakiShip BGC Hub",
    address: "26th St, Bonifacio Global City, Taguig, Metro Manila",
    distance: "Nearby",
    status: "Open",
    capacity: "150",
    latitude: 14.5496,
    longitude: 121.0437,
  },
  {
    id: "9c9b9999-9999-9999-9999-999999999903",
    name: "PakiShip Makati Hub",
    address: "Ayala Ave, Makati, Metro Manila",
    distance: "Nearby",
    status: "Open",
    capacity: "120",
    latitude: 14.5547,
    longitude: 121.0244,
  },
  {
    id: "9c9b9999-9999-9999-9999-999999999904",
    name: "PakiShip SM North Hub",
    address: "SM North EDSA, North Ave, Quezon City, Metro Manila",
    distance: "Nearby",
    status: "Open",
    capacity: "120",
    latitude: 14.6565,
    longitude: 121.0298,
  },
];

type DraftItemInput = {
  size?: unknown;
  weight?: unknown;
  itemType?: unknown;
  deliveryGuarantee?: unknown;
  quantity?: unknown;
  photoName?: unknown;
};

type SelectedDropOffPoint = {
  id: string;
  name: string | null;
  address: string | null;
  distance: string | null;
  status: string | null;
  capacity: string | null;
};

type RelayHub = SelectedDropOffPoint & {
  latitude: number;
  longitude: number;
};

type CoordinateLocationInput = {
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
};

function asNonEmptyString(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function isMissingOptionalDraftColumnError(error: unknown) {
  const maybeError = error as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  const searchable = [
    maybeError.code,
    maybeError.message,
    maybeError.details,
    maybeError.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    maybeError.code === "PGRST204" ||
    maybeError.code === "42703" ||
    searchable.includes("schema cache") ||
    (searchable.includes("column") && searchable.includes("does not exist")) ||
    (searchable.includes("could not find") && searchable.includes("column"))
  );
}

function getMissingDraftColumnName(error: unknown) {
  const maybeError = error as {
    message?: string;
    details?: string;
    hint?: string;
  };
  const searchable = [maybeError.message, maybeError.details, maybeError.hint]
    .filter(Boolean)
    .join(" ");

  return (
    searchable.match(/'([^']+)' column/)?.[1] ??
    searchable.match(/column "([^"]+)"/)?.[1] ??
    null
  );
}

function parsePositiveInteger(value: unknown, fallback = 1) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1) {
    return null;
  }

  return number;
}

function createTrackingNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const serial = Math.floor(100000 + Math.random() * 900000);
  return `PKS-${year}-${serial}`;
}

function createDropOffDeadline() {
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + 24);
  return deadline.toISOString();
}

function formatDropOffDeadline(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getHistoryStatus(status: string) {
  if (status === "submitted") {
    return {
      label: "Booking Confirmed",
      isLive: true,
      bucket: "active" as const,
    };
  }

  if (status === "picked_up") {
    return {
      label: "Picked Up",
      isLive: true,
      bucket: "active" as const,
    };
  }

  if (status === "out_for_delivery") {
    return {
      label: "Out for Delivery",
      isLive: true,
      bucket: "active" as const,
    };
  }

  if (status === "delivered") {
    return {
      label: "Delivered",
      isLive: false,
      bucket: "completed" as const,
    };
  }

  return {
    label: status === "lost" ? "Lost" : "Cancelled",
    isLive: false,
    bucket: "completed" as const,
  };
}

function getHistoryType(items: Array<{ item_type?: string | null; delivery_guarantee?: string | null }>) {
  const firstItem = items[0];
  if (!firstItem) return "Parcel Delivery";
  if (firstItem.delivery_guarantee) {
    return `${String(firstItem.delivery_guarantee).charAt(0).toUpperCase()}${String(
      firstItem.delivery_guarantee,
    ).slice(1)} Delivery`;
  }
  if (firstItem.item_type) {
    return String(firstItem.item_type);
  }
  return "Parcel Delivery";
}

function formatPesoAmount(value: unknown) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function hashAddressSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 10000;
  }

  return hash;
}

type RouteEstimate = {
  distanceKm: number;
  durationMinutes: number;
  distanceText: string;
  durationText: string;
  provider: "google_maps" | "fallback";
};

function createFallbackRouteEstimate(
  pickupAddress: string,
  deliveryAddress: string,
): RouteEstimate {
  const combinedSeed = hashAddressSeed(
    `${pickupAddress.toLowerCase()}::${deliveryAddress.toLowerCase()}`,
  );
  const baseDistance = 2 + (combinedSeed % 240) / 10;
  const distanceKm = Math.max(1.5, Number(baseDistance.toFixed(1)));
  const durationMinutes = Math.max(12, Math.round(distanceKm * 4.5 + 8));

  return {
    distanceKm,
    durationMinutes,
    distanceText: `${distanceKm.toFixed(1)} km`,
    durationText:
      durationMinutes >= 60
        ? `${Math.floor(durationMinutes / 60)} hr ${durationMinutes % 60} mins`
        : `${durationMinutes} mins`,
    provider: "fallback",
  };
}

function calculateHaversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return radiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function readCoordinates(value: CoordinateLocationInput | undefined) {
  const latitude = Number(value?.lat);
  const longitude = Number(value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function formatRouteDuration(durationMinutes: number) {
  return durationMinutes >= 60
    ? `${Math.floor(durationMinutes / 60)} hr ${durationMinutes % 60} mins`
    : `${durationMinutes} mins`;
}

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude},${longitude}`;
}

@Injectable()
export class ParcelDraftsService {
  private apiCenterToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly repository: ParcelDraftsRepository,
    private readonly customerNotificationsService: CustomerNotificationsService,
    private readonly supabaseService: SupabaseService,
    private readonly googleMapsService: GoogleMapsService,
  ) {}

  private async createRouteEstimate(
    pickupAddress: string,
    deliveryAddress: string,
  ): Promise<RouteEstimate> {
    try {
      const matrix = await this.googleMapsService.getDistanceMatrix(
        pickupAddress,
        deliveryAddress,
      );
      const element = matrix?.rows?.[0]?.elements?.[0];
      const distanceMeters = Number(element?.distance?.value ?? 0);
      const durationSeconds = Number(element?.duration?.value ?? 0);

      if (
        element?.status === "OK" &&
        Number.isFinite(distanceMeters) &&
        distanceMeters > 0 &&
        Number.isFinite(durationSeconds) &&
        durationSeconds > 0
      ) {
        const distanceKm = Number((distanceMeters / 1000).toFixed(1));
        const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

        return {
          distanceKm,
          durationMinutes,
          distanceText: element.distance?.text || `${distanceKm.toFixed(1)} km`,
          durationText:
            element.duration?.text ||
            (durationMinutes >= 60
              ? `${Math.floor(durationMinutes / 60)} hr ${durationMinutes % 60} mins`
              : `${durationMinutes} mins`),
          provider: "google_maps",
        };
      }
    } catch (error) {
      console.warn(
        "[parcel-drafts] Google Distance Matrix failed; using fallback estimate",
        error instanceof Error ? error.message : error,
      );
    }

    return createFallbackRouteEstimate(pickupAddress, deliveryAddress);
  }

  private async createRelayRouteEstimate(input: {
    pickupLocation: CoordinateLocationInput;
    deliveryLocation: CoordinateLocationInput;
    pickupHub: RelayHub;
    dropOffPoint: RelayHub;
  }): Promise<RouteEstimate> {
    const pickupCoordinates = readCoordinates(input.pickupLocation);
    const deliveryCoordinates = readCoordinates(input.deliveryLocation);
    const pickupAddress = asNonEmptyString(input.pickupLocation.address);
    const deliveryAddress = asNonEmptyString(input.deliveryLocation.address);

    const origin = pickupCoordinates
      ? formatCoordinates(pickupCoordinates.latitude, pickupCoordinates.longitude)
      : pickupAddress;
    const destination = deliveryCoordinates
      ? formatCoordinates(deliveryCoordinates.latitude, deliveryCoordinates.longitude)
      : deliveryAddress;

    if (!origin || !destination) {
      throw new BadRequestException("PakiShare needs sender and receiver map locations.");
    }

    try {
      const result = await this.googleMapsService.getDirections(origin, destination, [
        formatCoordinates(input.pickupHub.latitude, input.pickupHub.longitude),
        formatCoordinates(input.dropOffPoint.latitude, input.dropOffPoint.longitude),
      ]);
      const legs = result?.routes?.[0]?.legs ?? [];

      if (result.status === "OK" && legs.length > 0) {
        const totals = legs.reduce(
          (
            total: { distanceMeters: number; durationSeconds: number },
            leg: { distance?: { value?: unknown }; duration?: { value?: unknown } },
          ) => ({
            distanceMeters: total.distanceMeters + Number(leg?.distance?.value ?? 0),
            durationSeconds: total.durationSeconds + Number(leg?.duration?.value ?? 0),
          }),
          { distanceMeters: 0, durationSeconds: 0 },
        );

        if (
          Number.isFinite(totals.distanceMeters) &&
          totals.distanceMeters > 0 &&
          Number.isFinite(totals.durationSeconds) &&
          totals.durationSeconds > 0
        ) {
          const distanceKm = Number((totals.distanceMeters / 1000).toFixed(1));
          const durationMinutes = Math.max(1, Math.round(totals.durationSeconds / 60));

          return {
            distanceKm,
            durationMinutes,
            distanceText: `${distanceKm.toFixed(1)} km`,
            durationText: formatRouteDuration(durationMinutes),
            provider: "google_maps",
          };
        }
      }
    } catch (error) {
      console.warn(
        "[parcel-drafts] Google relay Directions failed; using fallback estimate",
        error instanceof Error ? error.message : error,
      );
    }

    const relayLegs = [
      [origin, formatCoordinates(input.pickupHub.latitude, input.pickupHub.longitude)],
      [
        formatCoordinates(input.pickupHub.latitude, input.pickupHub.longitude),
        formatCoordinates(input.dropOffPoint.latitude, input.dropOffPoint.longitude),
      ],
      [formatCoordinates(input.dropOffPoint.latitude, input.dropOffPoint.longitude), destination],
    ] as const;
    const estimates = await Promise.all(
      relayLegs.map(([legOrigin, legDestination]) =>
        this.createRouteEstimate(legOrigin, legDestination),
      ),
    );
    const distanceKm = Number(
      estimates.reduce((total, estimate) => total + estimate.distanceKm, 0).toFixed(1),
    );
    const durationMinutes = estimates.reduce(
      (total, estimate) => total + estimate.durationMinutes,
      0,
    );

    return {
      distanceKm,
      durationMinutes,
      distanceText: `${distanceKm.toFixed(1)} km`,
      durationText: formatRouteDuration(durationMinutes),
      provider: estimates.every((estimate) => estimate.provider === "google_maps")
        ? "google_maps"
        : "fallback",
    };
  }

  private async resolveRelayCoordinates(location: CoordinateLocationInput | undefined) {
    const coordinates = readCoordinates(location);
    if (coordinates) {
      return coordinates;
    }

    const address = asNonEmptyString(location?.address);
    if (!address) {
      return null;
    }

    try {
      const result = await this.googleMapsService.getGeocode(address);
      const resolvedLocation = result?.results?.[0]?.geometry?.location;
      const latitude = Number(resolvedLocation?.lat);
      const longitude = Number(resolvedLocation?.lng);

      if (
        result.status === "OK" &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude)
      ) {
        return { latitude, longitude };
      }
    } catch (error) {
      console.warn(
        "[parcel-drafts] relay address could not be geocoded",
        error instanceof Error ? error.message : error,
      );
    }

    return null;
  }

  private async getApiCenterAccessToken() {
    if (this.apiCenterToken && this.apiCenterToken.expiresAt > Date.now() + 30_000) {
      return this.apiCenterToken.value;
    }

    const baseUrl = process.env.APICENTER_URL?.replace(/\/$/, "");
    const tribeId = process.env.APICENTER_TRIBE_ID;
    const secret = process.env.APICENTER_TRIBE_SECRET;

    if (!baseUrl || !tribeId || !secret) {
      throw new InternalServerErrorException("APICenter credentials are not configured.");
    }

    const tokenPath = process.env.APICENTER_TOKEN_PATH || "/api/v1/auth/token";
    const response = await fetch(`${baseUrl}${tokenPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tribeId, secret }),
    });
    const text = await response.text();
    const result = text
      ? JSON.parse(text) as {
          accessToken?: string;
          token?: string;
          data?: { accessToken?: string; token?: string; expiresIn?: number };
        }
      : {};
    const token = result.data?.accessToken || result.data?.token || result.accessToken || result.token;

    if (!response.ok || !token) {
      throw new InternalServerErrorException(
        `ApiCenter token request failed (${response.status} ${tokenPath}): ${text || response.statusText}`,
      );
    }

    this.apiCenterToken = {
      value: token,
      expiresAt: Date.now() + Math.max(60, result.data?.expiresIn ?? 600) * 1000,
    };

    return token;
  }

  private async createPaymentCheckout(input: {
    draftId: string;
    amount: number;
    paymentMethod: string;
  }) {
    const baseUrl = process.env.APICENTER_URL?.replace(/\/$/, "");
    const tribeId = process.env.APICENTER_TRIBE_ID;

    if (!baseUrl || !tribeId || !process.env.APICENTER_TRIBE_SECRET) {
      return null;
    }

    const paymentMethodsBySelection: Record<string, string[]> = {
      gcash: ["gcash"],
      paymaya: ["maya"],
      maya: ["maya"],
      bdo: ["qrph"],
      bpi: ["qrph"],
      metrobank: ["qrph"],
      bank_transfer: ["qrph"],
    };
    const paymentMethods = paymentMethodsBySelection[input.paymentMethod];
    if (!paymentMethods) {
      return null;
    }

    const token = await this.getApiCenterAccessToken();
    const amountInCentavos = Math.max(100, Math.round(input.amount * 100));
    const response = await fetch(`${baseUrl}/api/v1/shared/payment/checkout/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-SDK-Version": process.env.APICENTER_SDK_VERSION || "1.1.2",
        "X-SDK-Tribe-Id": tribeId,
      },
      body: JSON.stringify({
        referenceId: input.draftId,
        idempotencyKey: `checkout-${input.draftId}-${Date.now()}`,
        successUrl: `http://localhost:3000/customer/send-parcel?payment=success&draftId=${input.draftId}`,
        cancelUrl: `http://localhost:3000/customer/send-parcel?payment=cancel&draftId=${input.draftId}`,
        paymentMethods,
        lineItems: [
          {
            name: "PakiShip Parcel Delivery",
            quantity: 1,
            amount: {
              value: amountInCentavos,
              currency: "PHP",
            },
          },
        ],
      }),
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new InternalServerErrorException(
        `ApiCenter payment request failed (${response.status} /api/v1/shared/payment/checkout/sessions): ${text || response.statusText}`,
      );
    }

    const data = result?.data ?? result;
    return {
      checkoutUrl:
        data.redirectUrl ||
        data.redirect_url ||
        data.checkoutUrl ||
        data.checkout_url ||
        data.url ||
        null,
      checkoutId: data.checkoutId || data.id || null,
      provider: data.provider || "paymongo",
      status: data.status || "created",
    };
  }

  async estimateRoute(user: SessionPayload, body: Record<string, unknown>) {
    if (!user?.userId) {
      throw new BadRequestException("Authenticated user is required.");
    }

    const pickupAddress = asNonEmptyString(
      (body.pickupLocation as { address?: unknown } | undefined)?.address,
    );
    const deliveryAddress = asNonEmptyString(
      (body.deliveryLocation as { address?: unknown } | undefined)?.address,
    );

    if (!pickupAddress || !deliveryAddress) {
      throw new BadRequestException("Pickup and delivery locations are required.");
    }

    return {
      pickupAddress,
      deliveryAddress,
      ...(await this.createRouteEstimate(pickupAddress, deliveryAddress)),
    };
  }

  async getRoute(user: SessionPayload, body: Record<string, unknown>) {
    if (!user?.userId) {
      throw new BadRequestException("Authenticated user is required.");
    }

    const origin = asNonEmptyString(body.origin);
    const destination = asNonEmptyString(body.destination);

    if (!origin || !destination) {
      throw new BadRequestException("Origin and destination are required.");
    }

    const result = await this.googleMapsService.getDirections(origin, destination);
    if (result.status !== "OK" || !result.routes?.[0]?.overview_polyline?.points) {
      throw new InternalServerErrorException(
        `Google Directions failed: ${result.status || "UNKNOWN"}`,
      );
    }

    const leg = result.routes[0].legs?.[0];
    return {
      polyline: result.routes[0].overview_polyline.points,
      distance: Number(leg?.distance?.value ?? 0) / 1000,
      duration: Number(leg?.duration?.value ?? 0) / 60,
      distanceText: leg?.distance?.text ?? null,
      durationText: leg?.duration?.text ?? null,
      provider: "google_maps",
    };
  }

  async reverseGeocode(user: SessionPayload, body: Record<string, unknown>) {
    if (!user?.userId) {
      throw new BadRequestException("Authenticated user is required.");
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException("Latitude and longitude are required.");
    }

    const result = await this.googleMapsService.getReverseGeocode(lat, lng);
    return {
      address:
        result.status === "OK"
          ? result.results?.[0]?.formatted_address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          : `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    };
  }

  async autocompleteLocation(user: SessionPayload, query: string) {
    if (!user?.userId) {
      throw new BadRequestException("Authenticated user is required.");
    }

    const cleanQuery = asNonEmptyString(query);
    if (!cleanQuery || cleanQuery.length < 2) {
      return { predictions: [] };
    }

    const result = await this.googleMapsService.getAutocomplete(cleanQuery);
    return {
      predictions: (result.predictions ?? []).map((item: any) => ({
        placeId: item.place_id,
        description: item.description,
        mainText: item.structured_formatting?.main_text ?? item.description,
        secondaryText: item.structured_formatting?.secondary_text ?? "",
      })),
    };
  }

  async getPlaceDetails(user: SessionPayload, placeId: string) {
    if (!user?.userId) {
      throw new BadRequestException("Authenticated user is required.");
    }

    const cleanPlaceId = asNonEmptyString(placeId);
    if (!cleanPlaceId) {
      throw new BadRequestException("Place ID is required.");
    }

    const result = await this.googleMapsService.getPlaceDetails(cleanPlaceId);
    const location = result.result?.geometry?.location;

    if (result.status !== "OK" || !location) {
      throw new BadRequestException("Unable to resolve the selected Google Maps place.");
    }

    return {
      address: result.result?.formatted_address || result.result?.name || "",
      details: result.result?.name || "Google Maps",
      lat: Number(location.lat),
      lng: Number(location.lng),
      placeId: cleanPlaceId,
    };
  }

  async getAvailableHubs(user: SessionPayload) {
    if (!user?.userId) {
      throw new BadRequestException("Authenticated user is required.");
    }

    return {
      hubs: AVAILABLE_HUBS,
    };
  }

  private async getRelayHubs() {
    const hubs = AVAILABLE_HUBS.map<RelayHub>((hub) => ({
      ...hub,
      distance: null,
    }));

    if (hubs.length < 2) {
      throw new BadRequestException("PakiShare needs at least two configured hubs.");
    }

    return hubs;
  }

  private findNearestRelayHub(
    hubs: RelayHub[],
    location: { latitude: number; longitude: number },
    excludedHubId?: string,
  ) {
    const nearest = hubs
      .filter((hub) => hub.id !== excludedHubId)
      .map((hub) => ({
        hub,
        distanceKm: calculateHaversineKm(
          location.latitude,
          location.longitude,
          hub.latitude,
          hub.longitude,
        ),
      }))
      .sort((left, right) => left.distanceKm - right.distanceKm)[0];

    if (!nearest) {
      throw new BadRequestException("Unable to optimize the PakiShare hub route.");
    }

    return {
      ...nearest.hub,
      distance: `${nearest.distanceKm.toFixed(1)} km`,
    };
  }

  private async optimizeRelayHubs(
    pickupLocation: CoordinateLocationInput | undefined,
    deliveryLocation: CoordinateLocationInput | undefined,
  ) {
    const [pickupCoordinates, deliveryCoordinates] = await Promise.all([
      this.resolveRelayCoordinates(pickupLocation),
      this.resolveRelayCoordinates(deliveryLocation),
    ]);
    if (!pickupCoordinates || !deliveryCoordinates) {
      throw new BadRequestException(
        "PakiShare needs sender and receiver locations that Google Maps can resolve.",
      );
    }

    const hubs = await this.getRelayHubs();
    const pickupHub = this.findNearestRelayHub(hubs, pickupCoordinates);
    const dropOffPoint = this.findNearestRelayHub(hubs, deliveryCoordinates, pickupHub.id);

    return { pickupHub, dropOffPoint };
  }

  async previewRelayHubs(user: SessionPayload, body: Record<string, unknown>) {
    if (!user?.userId) {
      throw new BadRequestException("Authenticated user is required.");
    }

    const pickupLocation = body.pickupLocation as CoordinateLocationInput | undefined;
    const deliveryLocation = body.deliveryLocation as CoordinateLocationInput | undefined;
    const { pickupHub, dropOffPoint } = await this.optimizeRelayHubs(
      pickupLocation,
      deliveryLocation,
    );

    return {
      pickupHub,
      dropOffPoint,
    };
  }

  private async saveSelectedService(
    draftId: string,
    serviceId: string,
    servicePrice: number,
    dropOffPoint: SelectedDropOffPoint | null,
  ) {
    void draftId;
    void serviceId;
    void servicePrice;
    void dropOffPoint;
  }

  private async notifyOperatorsForRelayBooking(input: {
    hubId: string;
    hubName: string;
    trackingNumber: string;
    receiverName: string;
    dropOffDeadlineLabel: string | null;
  }) {
    const admin = this.supabaseService.createAdminClient();
    const { data, error } = await admin.schema("routing").from("operator_hubs")
      .select("owner_user_id")
      .eq("id", input.hubId)
      .eq("is_active", true);

    if (error) {
      console.warn("[parcel-drafts] unable to find operators for relay booking alert", error.message);
      return;
    }

    const operatorUserIds = [
      ...new Set(
        ((data ?? []) as Array<{ owner_user_id: string | null }>)
          .map((row) => row.owner_user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (operatorUserIds.length === 0) {
      return;
    }

    const deadlineText = input.dropOffDeadlineLabel
      ? ` Drop-off deadline: ${input.dropOffDeadlineLabel}.`
      : "";
    const { error: insertError } = await admin.schema("notifications").from("notifications").insert(
      operatorUserIds.map((operatorUserId) => ({
        user_id: operatorUserId,
        type: "delivery",
        title: "New relay booking assigned",
        message: `${input.trackingNumber} is assigned to ${input.hubName} for ${input.receiverName}.${deadlineText}`,
        source_service: "pakiship",
      })),
    );

    if (insertError) {
      console.warn("[parcel-drafts] unable to create operator relay booking alert", insertError.message);
    }
  }

  async saveRouteDetails(user: SessionPayload, body: Record<string, unknown>) {
    const draftId = body.draftId ? String(body.draftId) : null;
    const pickupAddress = asNonEmptyString(
      (body.pickupLocation as { address?: unknown } | undefined)?.address,
    );
    const deliveryAddress = asNonEmptyString(
      (body.deliveryLocation as { address?: unknown } | undefined)?.address,
    );

    if (!pickupAddress || !deliveryAddress) {
      throw new BadRequestException("Pickup and delivery locations are required.");
    }

    const estimate = await this.createRouteEstimate(pickupAddress, deliveryAddress);
    const savedDistance = asNonEmptyString(body.distance) ?? estimate.distanceText;
    const savedDuration = asNonEmptyString(body.duration) ?? estimate.durationText;

    const { data, error } = await this.repository.saveStepOneDraft(draftId, user.userId, {
      pickup_address: pickupAddress,
      delivery_address: deliveryAddress,
      status: "draft",
    });

    if (error || !data) {
      throw new InternalServerErrorException(
        draftId ? "Unable to update parcel draft." : "Unable to create parcel draft.",
      );
    }

    return {
      draftId: data.id,
      distance: savedDistance,
      duration: savedDuration,
      distanceKm: estimate.distanceKm,
      durationMinutes: estimate.durationMinutes,
    };
  }

  async getDraftDetails(user: SessionPayload, draftId: string, itemsLimit?: number) {
    const limit = Math.min(
      Math.max(itemsLimit ?? DEFAULT_ITEMS_PAGE_SIZE, 1),
      MAX_ITEMS_PAGE_SIZE,
    );
    const { data, error, itemCount, itemPageSize } = await this.repository.findOwnedDraftWithItems(
      draftId,
      user.userId,
      limit,
    );

    if (error || !data) {
      throw new NotFoundException("Parcel draft not found.");
    }

    const draftItems = (data as typeof data & { parcel_draft_items?: Array<Record<string, any>> }).parcel_draft_items ?? [];
    const items = draftItems.map((item) => ({
      id: item.id,
      size: item.size,
      weight: item.weight_text,
      itemType: item.item_type,
      deliveryGuarantee: item.delivery_guarantee,
      quantity: item.quantity,
      photoName: item.photo_url,
    }));

    return {
      draft: {
        id: data.id,
        pickupLocation: {
          address: data.pickup_address,
          details: null,
        },
        deliveryLocation: {
          address: data.delivery_address,
          details: null,
        },
        distance: null,
        duration: null,
        stepCompleted: null,
        status: data.status,
        trackingNumber: data.tracking_number,
        items,
      },
      pagination: {
        totalItems: itemCount,
        itemsReturned: items.length,
        limit: itemPageSize,
        hasMore: itemCount > items.length,
      },
    };
  }

  async getDraftItemsPage(user: SessionPayload, draftId: string, limit?: number, offset?: number) {
    const requestedLimit = Math.min(
      Math.max(limit ?? DEFAULT_ITEMS_PAGE_SIZE, 1),
      MAX_ITEMS_PAGE_SIZE,
    );
    const safeOffset = Math.max(offset ?? 0, 0);
    const { data, error, totalCount } = await this.repository.listOwnedDraftItemsWithCount(
      draftId,
      user.userId,
      requestedLimit,
      safeOffset,
    );

    if (error || !data) {
      throw new NotFoundException("Parcel draft not found.");
    }

    return {
      items: data.map((item: { id: string; size: string; weight_text: string; item_type: string; delivery_guarantee: string; quantity: number; photo_url: string | null }) => ({
        id: item.id,
        size: item.size,
        weight: item.weight_text,
        itemType: item.item_type,
        deliveryGuarantee: item.delivery_guarantee,
        quantity: item.quantity,
        photoName: item.photo_url,
      })),
      pagination: {
        totalItems: totalCount,
        limit: requestedLimit,
        offset: safeOffset,
        hasMore: safeOffset + data.length < totalCount,
      },
    };
  }

  private normalizeDraftItemInput(input: DraftItemInput) {
    const size = asNonEmptyString(input.size);
    const weight = asNonEmptyString(input.weight);
    const itemType = asNonEmptyString(input.itemType);
    const deliveryGuarantee = asNonEmptyString(input.deliveryGuarantee);
    const quantity = parsePositiveInteger(input.quantity, 1);

    if (!size || !weight || !itemType || !deliveryGuarantee) {
      throw new BadRequestException("Parcel details are incomplete.");
    }

    if (!quantity || quantity > MAX_ITEM_QUANTITY) {
      throw new BadRequestException(`Quantity must be between 1 and ${MAX_ITEM_QUANTITY}.`);
    }

    return {
      size,
      weight_text: weight,
      item_type: itemType,
      delivery_guarantee: deliveryGuarantee,
      quantity,
      photo_url: asNonEmptyString(input.photoName),
    };
  }

  async addDraftItems(user: SessionPayload, draftId: string, body: Record<string, unknown>) {
    const ownedDraft = await this.repository.findOwnedDraftSummary(draftId, user.userId);
    if (ownedDraft.error || !ownedDraft.data) {
      throw new NotFoundException("Parcel draft not found.");
    }

    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length < 1 || rawItems.length > MAX_ITEMS_PER_REQUEST) {
      throw new BadRequestException(
        `You can submit between 1 and ${MAX_ITEMS_PER_REQUEST} items per request.`,
      );
    }

    const normalizedItems = rawItems.map((rawItem) => ({
      parcel_draft_id: draftId,
      ...this.normalizeDraftItemInput((rawItem ?? {}) as DraftItemInput),
    }));

    const { data, error } = await this.repository.createDraftItems(normalizedItems);
    if (error || !data) {
      throw new InternalServerErrorException("Unable to save parcel item.");
    }

    const stepResult = await this.repository.updateOwnedDraftState(draftId, user.userId, {
      step_completed: 3,
    });

    if (stepResult.error) {
      throw new InternalServerErrorException("Unable to update parcel draft progress.");
    }

    return {
      itemId: data[0]?.id ?? null,
      itemIds: data.map((item) => item.id),
      createdCount: data.length,
    };
  }

  async updateDraftItem(
    user: SessionPayload,
    draftId: string,
    itemId: string,
    body: Record<string, unknown>,
  ) {
    const quantity = parsePositiveInteger(body.quantity);
    if (!quantity || quantity > MAX_ITEM_QUANTITY) {
      throw new BadRequestException(`Quantity must be between 1 and ${MAX_ITEM_QUANTITY}.`);
    }

    const ownedItem = await this.repository.findOwnedDraftItem(draftId, itemId, user.userId);
    if (ownedItem.error || !ownedItem.data) {
      throw new NotFoundException("Parcel item not found.");
    }

    const updateResult = await this.repository.updateDraftItemQuantity(draftId, itemId, quantity);
    if (updateResult.error) {
      throw new InternalServerErrorException("Unable to update parcel quantity.");
    }

    const stepResult = await this.repository.updateOwnedDraftState(draftId, user.userId, {
      step_completed: 3,
    });
    if (stepResult.error) {
      throw new InternalServerErrorException("Unable to update parcel draft progress.");
    }

    return { itemId, quantity };
  }

  async removeDraftItem(user: SessionPayload, draftId: string, itemId: string) {
    const ownedItem = await this.repository.findOwnedDraftItem(draftId, itemId, user.userId);
    if (ownedItem.error || !ownedItem.data) {
      throw new NotFoundException("Parcel item not found.");
    }

    const deleteResult = await this.repository.deleteDraftItem(draftId, itemId);
    if (deleteResult.error) {
      throw new InternalServerErrorException("Unable to remove parcel item.");
    }

    const stepResult = await this.repository.updateOwnedDraftState(draftId, user.userId, {
      step_completed: 3,
    });
    if (stepResult.error) {
      throw new InternalServerErrorException("Unable to update parcel draft progress.");
    }

    return { itemId };
  }

  async selectDraftService(user: SessionPayload, draftId: string, body: Record<string, unknown>) {
    const serviceId = String(body.serviceId ?? "");
    const servicePrice = Number(body.servicePrice ?? 0);
    const pickupLocation = body.pickupLocation as CoordinateLocationInput | undefined;
    const deliveryLocation = body.deliveryLocation as CoordinateLocationInput | undefined;

    if (!ALLOWED_SERVICES.has(serviceId)) {
      throw new BadRequestException("Please select a valid delivery service.");
    }

    if (!Number.isFinite(servicePrice) || servicePrice <= 0) {
      throw new BadRequestException("Service pricing is invalid.");
    }

    const ownedDraft = await this.repository.findOwnedDraftSummary(draftId, user.userId);
    if (ownedDraft.error || !ownedDraft.data) {
      throw new NotFoundException("Parcel draft not found.");
    }

    let pickupHub: RelayHub | null = null;
    let dropOffPoint: RelayHub | null = null;
    let routeEstimate: RouteEstimate | null = null;
    if (serviceId === "pakishare") {
      ({ pickupHub, dropOffPoint } = await this.optimizeRelayHubs(
        pickupLocation,
        deliveryLocation,
      ));
      routeEstimate = await this.createRelayRouteEstimate({
        pickupLocation: pickupLocation ?? {},
        deliveryLocation: deliveryLocation ?? {},
        pickupHub,
        dropOffPoint,
      });
    }

    const updateResult = await this.repository.updateOwnedDraftState(draftId, user.userId, {
      status: "draft",
      service_id: serviceId,
      service_price: servicePrice,
      delivery_mode: serviceId === "pakishare" ? "relay" : "direct",
      drop_off_point_id: serviceId === "pakishare" ? dropOffPoint?.id : null,
      drop_off_point_name: serviceId === "pakishare" ? dropOffPoint?.name : null,
      drop_off_point_address: serviceId === "pakishare" ? dropOffPoint?.address : null,
      drop_off_point_distance_text: serviceId === "pakishare" ? dropOffPoint?.distance : null,
      drop_off_point_status: serviceId === "pakishare" ? dropOffPoint?.status : null,
      drop_off_point_capacity: serviceId === "pakishare" ? dropOffPoint?.capacity : null,
      pickup_address:
        serviceId === "pakishare"
          ? ownedDraft.data.pickup_address
          : ownedDraft.data.pickup_address,
      delivery_address:
        serviceId === "pakishare"
          ? ownedDraft.data.delivery_address
          : ownedDraft.data.delivery_address,
    });
    if (updateResult.error) {
      throw new InternalServerErrorException("Unable to save delivery service right now.");
    }

    await this.saveSelectedService(
      draftId,
      serviceId,
      servicePrice,
      serviceId === "pakishare" ? dropOffPoint : null,
    );

    return {
      draftId,
      stepCompleted: 4,
      status: "draft",
      service: {
        id: serviceId,
        price: servicePrice,
        pickupHub,
        dropOffPoint,
        routeEstimate,
      },
    };
  }

  async completeBooking(user: SessionPayload, draftId: string, body: Record<string, unknown>) {
    const senderName = asNonEmptyString(body.senderName);
    const senderPhone = String(body.senderPhone ?? "").trim();
    const receiverName = asNonEmptyString(body.receiverName);
    const receiverPhone = String(body.receiverPhone ?? "").trim();
    const paymentMethod = asNonEmptyString(body.paymentMethod);
    const paymentResponsibility = asNonEmptyString(body.paymentResponsibility);
    const selectedService = asNonEmptyString(body.selectedService);
    const servicePrice = Number(body.servicePrice ?? 0);
    const totalParcels = Number(body.totalParcels ?? 0);
    const distance = asNonEmptyString(body.distance) ?? "";
    const duration = asNonEmptyString(body.duration) ?? "";

    if (!senderName || !receiverName) {
      throw new BadRequestException("Sender and receiver names are required.");
    }

    if (!PHONE_REGEX.test(senderPhone) || !PHONE_REGEX.test(receiverPhone)) {
      throw new BadRequestException("Phone numbers must use the 09XXXXXXXXX format.");
    }

    if (!paymentMethod) {
      throw new BadRequestException("Please select a payment method before continuing.");
    }

    if (!selectedService || !Number.isFinite(servicePrice) || servicePrice <= 0) {
      throw new BadRequestException("Delivery service details are incomplete.");
    }

    const ownedDraft = await this.repository.findOwnedDraftSummary(draftId, user.userId);
    if (ownedDraft.error || !ownedDraft.data) {
      throw new NotFoundException("Parcel draft not found.");
    }

    if (ownedDraft.data.service_id !== selectedService) {
      throw new BadRequestException("Please confirm the selected delivery service before booking.");
    }

    if (selectedService === "pakishare" && !ownedDraft.data.drop_off_point_id) {
      throw new BadRequestException("PakiShare requires a saved drop-off hub before booking.");
    }

    const trackingNumber = ownedDraft.data.tracking_number || createTrackingNumber();
    const dropOffPoint =
      selectedService === "pakishare"
        ? {
            id: ownedDraft.data.drop_off_point_id,
            name: "Selected PakiShare hub",
            address: "Hub address available in drop-off point records",
          }
        : null;
    const dropOffInstructions = dropOffPoint
      ? [
          `Bring your parcel to ${dropOffPoint.name}.`,
          `Show or quote tracking number ${trackingNumber} at the counter.`,
          "Hand the parcel to the hub operator for intake scanning.",
        ]
      : [];
    const dropOffDeadlineAt = selectedService === "pakishare" ? createDropOffDeadline() : null;
    const dropOffDeadlineLabel = dropOffDeadlineAt
      ? formatDropOffDeadline(dropOffDeadlineAt)
      : null;

    const bookingPatch = {
      step_completed: 5,
      status: "submitted",
      tracking_number: trackingNumber,
      sender_name: senderName,
      sender_phone: senderPhone,
      receiver_name: receiverName,
      receiver_phone: receiverPhone,
      service_id: selectedService,
      service_price: servicePrice,
      delivery_mode: selectedService === "pakishare" ? "relay" : "direct",
    };

    const updateResult = await this.repository.updateOwnedDraftState(
      draftId,
      user.userId,
      bookingPatch,
    );

    if (
      updateResult.error ||
      !updateResult.data ||
      updateResult.data.tracking_number !== trackingNumber
    ) {
      const missingColumn = updateResult.error
        ? getMissingDraftColumnName(updateResult.error)
        : null;
      console.error("[parcel-drafts] booking completion update failed", {
        draftId,
        error: updateResult.error,
        data: updateResult.data,
      });
      if (missingColumn) {
        throw new InternalServerErrorException(
          `Database schema is missing parcel_drafts.${missingColumn}. Align the parcel service schema before booking.`,
        );
      }
      throw new InternalServerErrorException("Unable to complete booking right now.");
    }

    try {
      await this.customerNotificationsService.createNotification(
        user.userId,
        "delivery",
        selectedService === "pakishare"
          ? "Relay booking confirmed"
          : "Parcel booking confirmed",
        selectedService === "pakishare" && dropOffPoint
          ? `Tracking No. ${trackingNumber}. Drop off your parcel at ${dropOffPoint.name}: ${dropOffPoint.address}. Deadline: ${dropOffDeadlineLabel}.`
          : `Your parcel for ${receiverName} is booked. Tracking No. ${trackingNumber}.`,
      );
    } catch (error) {
      console.warn(
        "[parcel-drafts] booking completed but customer notification could not be created",
        error instanceof Error ? error.message : error,
      );
    }

    if (selectedService === "pakishare" && dropOffPoint?.id) {
      try {
        await this.notifyOperatorsForRelayBooking({
          hubId: dropOffPoint.id,
          hubName: dropOffPoint.name || "Selected PakiShare hub",
          trackingNumber,
          receiverName,
          dropOffDeadlineLabel,
        });
      } catch (error) {
        console.warn(
          "[parcel-drafts] booking completed but operator notification could not be created",
          error instanceof Error ? error.message : error,
        );
      }
    }

    await this.ensureDriverJobForBooking({
      draftId,
      trackingNumber,
      servicePrice,
    });

    const payment = await this.createPaymentCheckout({
      draftId,
      amount: servicePrice,
      paymentMethod,
    });

    return {
      draftId,
      trackingNumber,
      stepCompleted: 5,
      status: "submitted",
      booking: {
        senderName,
        senderPhone,
        receiverName,
        receiverPhone,
        paymentMethod,
        selectedService,
        servicePrice,
        totalParcels,
        distance,
        duration,
        dropOffPoint,
        dropOffInstructions,
        dropOffDeadlineAt,
        dropOffDeadlineLabel,
      },
      payment,
    };
  }

  private async ensureDriverJobForBooking(input: {
    draftId: string;
    trackingNumber: string;
    servicePrice: number;
  }) {
    const admin = this.supabaseService.createAdminClient();
    const existing = await admin.schema("driver").from("driver_jobs")
      .select("id")
      .eq("parcel_draft_id", input.draftId)
      .maybeSingle();

    if (existing.error) {
      console.warn(
        "[parcel-drafts] booking completed but existing driver job could not be checked",
        existing.error.message,
      );
      return;
    }

    if (existing.data) {
      return;
    }

    const insertResult = await admin.schema("driver").from("driver_jobs").insert({
      id: randomUUID(),
      job_number: input.trackingNumber,
      parcel_draft_id: input.draftId,
      driver_id: null,
      status: "available",
      earnings: input.servicePrice,
    });

    if (insertResult.error) {
      console.warn(
        "[parcel-drafts] booking completed but available driver job could not be created",
        insertResult.error.message,
      );
    }
  }

  async getTrackingDetails(user: SessionPayload, trackingNumber: string) {
    const { data, error } = await this.repository.findOwnedSubmittedDraftByTrackingNumber(
      user.userId,
      trackingNumber.trim(),
    );

    if (error || !data) {
      throw new NotFoundException("Parcel not found for that tracking number.");
    }

    const createdTime = new Date();

    return {
      trackingNumber: data.tracking_number,
      status:
        data.status === "submitted" ? "Booking Confirmed" : data.status,
      origin: data.pickup_address,
      destination: data.delivery_address,
      estimatedDelivery: "Calculating...",
      distance: "Calculating...",
      driver: {
        name: "Assigning driver",
        phone: "Unavailable",
        vehicleType: "Pending dispatch",
        plateNumber: "TBD",
      },
      timeline: [
        {
          status: "Booking Confirmed",
          location: data.pickup_address,
          timestamp: createdTime.toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          completed: true,
        },
        {
          status: "Preparing for Pickup",
          location: data.pickup_address,
          timestamp: createdTime.toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          completed: data.status === "submitted",
        },
        {
          status: "In Transit",
          location: data.delivery_address,
          timestamp: "Pending",
          completed: false,
        },
        {
          status: "Delivered",
          location: data.delivery_address,
          timestamp: "Pending",
          completed: false,
        },
      ],
    };
  }

  async getHistory(user: SessionPayload) {
    const { data, error } = await this.repository.listOwnedHistory(user.userId);

    if (error) {
      throw new InternalServerErrorException("Unable to load parcel history right now.");
    }

    return {
      transactions: (data ?? []).map((draft) => {
        const row = draft as typeof draft & { parcel_draft_items?: Array<Record<string, any>> };
        const items = row.parcel_draft_items ?? [];
        const totalParcels = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
        const historyStatus = getHistoryStatus(draft.status);

        return {
          id: draft.tracking_number || draft.id,
          draftId: draft.id,
          trackingNumber: draft.tracking_number,
          date: "Date unavailable",
          createdAt: null,
          from: draft.pickup_address,
          to: draft.delivery_address,
          status: historyStatus.label,
          rawStatus: draft.status,
          type: getHistoryType(items),
          isLive: historyStatus.isLive,
          bucket: historyStatus.bucket,
          amount: formatPesoAmount(draft.service_price),
          distance: null,
          duration: null,
          totalParcels,
        };
      }),
    };
  }

  async getHistoryDetails(user: SessionPayload, trackingNumber: string) {
    const { data, error } = await this.repository.findOwnedHistoryByTrackingNumber(
      user.userId,
      trackingNumber.trim(),
    );

    if (error || !data) {
      throw new NotFoundException("Parcel history record not found.");
    }

    const historyRecord = data as typeof data & {
      service_id?: string | null;
      service_price?: number | string | null;
      parcel_draft_items?: Array<Record<string, any>>;
    };
    const items = historyRecord.parcel_draft_items ?? [];
    const totalParcels = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    const firstItem = items[0];
    const historyStatus = getHistoryStatus(historyRecord.status);
    const formattedAmount = formatPesoAmount(historyRecord.service_price);

    return {
      transaction: {
        id: historyRecord.tracking_number || historyRecord.id,
        trackingNumber: historyRecord.tracking_number,
        date: "Date unavailable",
        createdAt: null,
        from: historyRecord.pickup_address,
        to: historyRecord.delivery_address,
        status: historyStatus.label,
        rawStatus: historyRecord.status,
        type: getHistoryType(items),
        isLive: historyStatus.isLive,
        bucket: historyStatus.bucket,
        amount: formattedAmount,
        distance: null,
        duration: null,
        totalParcels,
      },
      details: {
        sender: {
          name: historyRecord.sender_name || "Not available",
          phone: historyRecord.sender_phone || "Not available",
          address: historyRecord.pickup_address,
        },
        receiver: {
          name: historyRecord.receiver_name || "Not available",
          phone: historyRecord.receiver_phone || "Not available",
          address: historyRecord.delivery_address,
        },
        parcel: {
          weight: firstItem?.weight_text || "Not available",
          dimensions: "Not stored yet",
          description:
            items.length > 0
              ? items
                  .map((item) => `${item.item_type || "Parcel"} x${item.quantity ?? 1}`)
                  .join(", ")
              : "No parcel items found",
          specialInstructions:
            firstItem?.delivery_guarantee
              ? `${firstItem.delivery_guarantee} handling`
              : "Standard handling",
          totalParcels,
        },
        payment: {
          deliveryFee: formattedAmount,
          totalAmount: formattedAmount,
          method: "Managed by payment service",
          responsibility: null,
          serviceId: historyRecord.service_id || null,
        },
        driver: historyStatus.isLive
          ? {
              name: "Assigning driver",
              phone: "Unavailable",
              vehicle: "Pending dispatch",
              rating: null,
            }
          : null,
        timeline: [
          {
            status: "Booking Created",
            time: "Date unavailable",
            location: historyRecord.pickup_address,
            completed: true,
          },
          {
            status: historyStatus.label,
            time: "Date unavailable",
            location: historyRecord.delivery_address,
            completed: true,
          },
        ],
      },
    };
  }
}
