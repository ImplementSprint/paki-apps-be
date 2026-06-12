import { Injectable, InternalServerErrorException } from "@nestjs/common";

@Injectable()
export class GoogleMapsService {
  private readonly apiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    "";

  private async makeRequest(path: string) {
    if (!this.apiKey.trim()) {
      throw new InternalServerErrorException("Google Maps API key is not configured.");
    }

    const response = await fetch(`https://maps.googleapis.com${path}`);
    const result = await response.json().catch(() => null);

    if (!response.ok || !result) {
      throw new InternalServerErrorException("Google Maps request failed.");
    }

    return result;
  }

  getDistanceMatrix(origins: string, destinations: string) {
    const params = new URLSearchParams({
      origins,
      destinations,
      region: "ph",
      units: "metric",
      key: this.apiKey,
    });

    return this.makeRequest(`/maps/api/distancematrix/json?${params.toString()}`);
  }

  getDirections(origin: string, destination: string, waypoints: string[] = []) {
    const params = new URLSearchParams({
      origin,
      destination,
      mode: "driving",
      region: "ph",
      key: this.apiKey,
    });

    if (waypoints.length > 0) {
      params.set("waypoints", waypoints.join("|"));
    }

    return this.makeRequest(`/maps/api/directions/json?${params.toString()}`);
  }

  getReverseGeocode(lat: number, lng: number) {
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      region: "ph",
      key: this.apiKey,
    });

    return this.makeRequest(`/maps/api/geocode/json?${params.toString()}`);
  }

  getGeocode(address: string) {
    const params = new URLSearchParams({
      address,
      region: "ph",
      key: this.apiKey,
    });

    return this.makeRequest(`/maps/api/geocode/json?${params.toString()}`);
  }

  getAutocomplete(query: string) {
    const params = new URLSearchParams({
      input: query,
      components: "country:ph",
      key: this.apiKey,
    });

    return this.makeRequest(`/maps/api/place/autocomplete/json?${params.toString()}`);
  }

  getPlaceDetails(placeId: string) {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "formatted_address,geometry,name",
      key: this.apiKey,
    });

    return this.makeRequest(`/maps/api/place/details/json?${params.toString()}`);
  }
}
