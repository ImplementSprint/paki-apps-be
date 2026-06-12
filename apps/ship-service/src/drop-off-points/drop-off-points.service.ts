import { Injectable } from "@nestjs/common";

type DropOffPoint = {
  id: string;
  name: string;
  address: string;
  distance: string;
  status: "Open" | "Busy";
  capacity: "High" | "Medium";
  latitude: number;
  longitude: number;
  landmark: string;
};

const FRASSATI_DROP_OFF_POINTS: DropOffPoint[] = [
  {
    id: "frassati-7-eleven",
    name: "7-Eleven Frassati Corner",
    address: "Near Frassati Building, Sampaloc, Manila",
    distance: "120 m",
    status: "Open",
    capacity: "High",
    latitude: 14.6096,
    longitude: 120.9894,
    landmark: "Frassati Building",
  },
  {
    id: "frassati-lawson",
    name: "Lawson Frassati Walk",
    address: "P. Campa St. beside Frassati, Sampaloc, Manila",
    distance: "230 m",
    status: "Open",
    capacity: "Medium",
    latitude: 14.6091,
    longitude: 120.989,
    landmark: "Frassati Building",
  },
  {
    id: "frassati-mini-stop",
    name: "Uncle John's Dapitan",
    address: "Dapitan St. near Frassati, Sampaloc, Manila",
    distance: "350 m",
    status: "Busy",
    capacity: "Medium",
    latitude: 14.6085,
    longitude: 120.9885,
    landmark: "Frassati Building",
  },
];

@Injectable()
export class DropOffPointsService {
  listNearby(query?: string) {
    const normalizedQuery = String(query ?? "").trim().toLowerCase();
    const points = normalizedQuery
      ? FRASSATI_DROP_OFF_POINTS.filter(
          (point) =>
            point.name.toLowerCase().includes(normalizedQuery) ||
            point.address.toLowerCase().includes(normalizedQuery) ||
            point.landmark.toLowerCase().includes(normalizedQuery),
        )
      : FRASSATI_DROP_OFF_POINTS;

    return {
      points,
      meta: {
        source: "dummy convenience stores near Frassati",
        placeholderMapProvider: "Google Maps API placeholder",
      },
    };
  }
}
