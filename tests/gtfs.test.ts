import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  GetDeparturesSchema,
  GetLiveStatusSchema,
  GetRouteScheduleSchema,
  SearchStationsSchema,
  GetStationInfoSchema,
} from '../src/domain/gtfs.js';

describe('GTFS Schemas', () => {
  describe('GetDeparturesSchema', () => {
    it('should accept valid input', () => {
      const input = {
        station_name: 'Grand Central Terminal',
        direction: 'inbound',
        limit: 10,
        include_realtime: true,
      };

      const result = GetDeparturesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should provide defaults for optional fields', () => {
      const input = {
        station_name: 'Grand Central',
      };

      const result = GetDeparturesSchema.parse(input);
      expect(result.direction).toBe('all');
      expect(result.limit).toBe(10);
      expect(result.include_realtime).toBe(true);
    });

    it('should reject empty station name', () => {
      const input = {
        station_name: 'A', // Too short (min 2)
      };

      const result = GetDeparturesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject invalid direction', () => {
      const input = {
        station_name: 'Grand Central',
        direction: 'northbound',
      };

      const result = GetDeparturesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject limit out of range', () => {
      const input1 = { station_name: 'Grand Central', limit: 0 };
      const input2 = { station_name: 'Grand Central', limit: 51 };

      expect(GetDeparturesSchema.safeParse(input1).success).toBe(false);
      expect(GetDeparturesSchema.safeParse(input2).success).toBe(false);
    });
  });

  describe('GetLiveStatusSchema', () => {
    it('should accept valid trip_id', () => {
      const input = { trip_id: 'TRAIN_123' };
      const result = GetLiveStatusSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject missing trip_id', () => {
      const input = {};
      const result = GetLiveStatusSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('GetRouteScheduleSchema', () => {
    it('should accept valid route name', () => {
      const input = {
        route_name: 'Hudson',
        direction: 'outbound',
      };

      const result = GetRouteScheduleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept valid date format', () => {
      const input = {
        route_name: 'Harlem',
        date: '2024-12-25',
      };

      const result = GetRouteScheduleSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid date format', () => {
      const input = {
        route_name: 'Harlem',
        date: '12/25/2024', // Wrong format
      };

      const result = GetRouteScheduleSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('SearchStationsSchema', () => {
    it('should accept valid query', () => {
      const input = {
        query: 'Grand',
        limit: 5,
      };

      const result = SearchStationsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty query', () => {
      const input = {
        query: '',
      };

      const result = SearchStationsSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should provide default limit', () => {
      const input = { query: 'Grand' };
      const result = SearchStationsSchema.parse(input);
      expect(result.limit).toBe(5);
    });
  });

  describe('GetStationInfoSchema', () => {
    it('should accept valid station name', () => {
      const input = { station_name: 'Croton-Harmon' };
      const result = GetStationInfoSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject short station name', () => {
      const input = { station_name: 'X' };
      const result = GetStationInfoSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
