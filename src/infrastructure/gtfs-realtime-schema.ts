// Minimal GTFS-Realtime protobuf schema used to decode MTA public feeds.
// Field names and numbers follow the GTFS-Realtime reference:
// https://gtfs.org/documentation/realtime/reference/
export const GTFS_REALTIME_PROTO = `
syntax = "proto2";

package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}

message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional Incrementality incrementality = 2 [default = FULL_DATASET];
  optional uint64 timestamp = 3;
  optional string feed_version = 4;

  enum Incrementality {
    FULL_DATASET = 0;
    DIFFERENTIAL = 1;
  }
}

message FeedEntity {
  required string id = 1;
  optional bool is_deleted = 2 [default = false];
  optional TripUpdate trip_update = 3;
  optional Alert alert = 5;
}

message TripUpdate {
  required TripDescriptor trip = 1;
  repeated StopTimeUpdate stop_time_update = 2;
  optional VehicleDescriptor vehicle = 3;
  optional uint64 timestamp = 4;

  message StopTimeEvent {
    optional int32 delay = 1;
    optional int64 time = 2;
    optional int32 uncertainty = 3;
  }

  message StopTimeUpdate {
    optional uint32 stop_sequence = 1;
    optional StopTimeEvent arrival = 2;
    optional StopTimeEvent departure = 3;
    optional string stop_id = 4;
    optional ScheduleRelationship schedule_relationship = 5 [default = SCHEDULED];

    enum ScheduleRelationship {
      SCHEDULED = 0;
      SKIPPED = 1;
      NO_DATA = 2;
      UNSCHEDULED = 3;
    }
  }
}

message Alert {
  repeated TimeRange active_period = 1;
  repeated EntitySelector informed_entity = 5;
  optional Cause cause = 6 [default = UNKNOWN_CAUSE];
  optional Effect effect = 7 [default = UNKNOWN_EFFECT];
  optional TranslatedString url = 8;
  optional TranslatedString header_text = 10;
  optional TranslatedString description_text = 11;

  enum Cause {
    UNKNOWN_CAUSE = 1;
    OTHER_CAUSE = 2;
    TECHNICAL_PROBLEM = 3;
    STRIKE = 4;
    DEMONSTRATION = 5;
    ACCIDENT = 6;
    HOLIDAY = 7;
    WEATHER = 8;
    MAINTENANCE = 9;
    CONSTRUCTION = 10;
    POLICE_ACTIVITY = 11;
    MEDICAL_EMERGENCY = 12;
  }

  enum Effect {
    NO_SERVICE = 1;
    REDUCED_SERVICE = 2;
    SIGNIFICANT_DELAYS = 3;
    DETOUR = 4;
    ADDITIONAL_SERVICE = 5;
    MODIFIED_SERVICE = 6;
    OTHER_EFFECT = 7;
    UNKNOWN_EFFECT = 8;
    STOP_MOVED = 9;
    NO_EFFECT = 10;
    ACCESSIBILITY_ISSUE = 11;
  }
}

message TimeRange {
  optional uint64 start = 1;
  optional uint64 end = 2;
}

message Position {
  required float latitude = 1;
  required float longitude = 2;
  optional float bearing = 3;
  optional double odometer = 4;
  optional float speed = 5;
}

message TripDescriptor {
  optional string trip_id = 1;
  optional string start_time = 2;
  optional string start_date = 3;
  optional ScheduleRelationship schedule_relationship = 4;
  optional string route_id = 5;
  optional uint32 direction_id = 6;

  enum ScheduleRelationship {
    SCHEDULED = 0;
    ADDED = 1;
    UNSCHEDULED = 2;
    CANCELED = 3;
    REPLACEMENT = 5;
    DUPLICATED = 6;
    DELETED = 7;
  }
}

message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
  optional string license_plate = 3;
}

message EntitySelector {
  optional string agency_id = 1;
  optional string route_id = 2;
  optional int32 route_type = 3;
  optional TripDescriptor trip = 4;
  optional string stop_id = 5;
  optional uint32 direction_id = 6;
}

message TranslatedString {
  repeated Translation translation = 1;

  message Translation {
    required string text = 1;
    optional string language = 2;
  }
}
`;
