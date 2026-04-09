import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import MapView, { MapPressEvent, Marker, Polyline } from 'react-native-maps';

type MapCoordinate = {
  latitude: number;
  longitude: number;
};

type RiverSearchResult = {
  boundingbox?: [string, string, string, string];
  display_name: string;
  lat: string;
  lon: string;
};

type RiverConditionKey = 'slow' | 'normal' | 'fast';
type TravelDirection = 'downstream' | 'upstream';

type DownstreamResult = {
  groundSpeed: number;
  timeHours: number;
  timeFormatted: string;
};

type UpstreamResult =
  | {
      possible: false;
      message: string;
    }
  | {
      possible: true;
      groundSpeed: number;
      timeHours: number;
      timeFormatted: string;
    };

const INITIAL_REGION = {
  latitude: 45.5412,
  longitude: -100.4878,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const DEFAULT_PADDLING_SPEED = '2.1';
const TIME_MARGIN_OF_ERROR = 0.3;

const RIVER_CONDITIONS: Record<RiverConditionKey, { label: string; speed: number }> = {
  slow: { label: 'Slow current (low flow)', speed: 1 },
  normal: { label: 'Normal current', speed: 2 },
  fast: { label: 'Fast current (high flow)', speed: 3 },
};

function formatCoordinateLabel(point: MapCoordinate, index: number) {
  return `P${index + 1}: ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

function calculateDistanceMiles(start: MapCoordinate, end: MapCoordinate) {
  const earthRadiusMiles = 3958.8;
  const dLat = ((end.latitude - start.latitude) * Math.PI) / 180;
  const dLon = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLat = (start.latitude * Math.PI) / 180;
  const endLat = (end.latitude * Math.PI) / 180;

  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
}

function calculateHeading(start: MapCoordinate, end: MapCoordinate) {
  const y = end.longitude - start.longitude;
  const x = end.latitude - start.latitude;
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;

  return Math.round((degrees + 360) % 360);
}

function formatTime(timeHours: number) {
  const hours = Math.floor(timeHours);
  const minutes = Math.round((timeHours - hours) * 60);

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function formatTimeRange(timeHours: number, margin: number) {
  const lowerBound = Math.max(0, timeHours * (1 - margin));
  const upperBound = timeHours * (1 + margin);

  return `${formatTime(lowerBound)} - ${formatTime(upperBound)}`;
}

function calcDownstream(
  distanceMiles: number,
  paddleSpeedMph: number,
  currentSpeedMph: number
): DownstreamResult {
  const groundSpeed = paddleSpeedMph + currentSpeedMph;
  const timeHours = distanceMiles / groundSpeed;

  return {
    groundSpeed,
    timeHours,
    timeFormatted: formatTime(timeHours),
  };
}

function calcUpstream(
  distanceMiles: number,
  paddleSpeedMph: number,
  currentSpeedMph: number
): UpstreamResult {
  if (paddleSpeedMph <= currentSpeedMph) {
    return {
      possible: false,
      message:
        'Your paddling speed is lower than the river current. Upstream travel is not possible.',
    };
  }

  const groundSpeed = paddleSpeedMph - currentSpeedMph;
  const timeHours = distanceMiles / groundSpeed;

  return {
    possible: true,
    groundSpeed,
    timeHours,
    timeFormatted: formatTime(timeHours),
  };
}

function getCurrentSpeed(condition: RiverConditionKey) {
  return RIVER_CONDITIONS[condition]?.speed ?? null;
}

export default function Index() {
  const [search, setSearch] = useState('');
  const [routePoints, setRoutePoints] = useState<MapCoordinate[]>([]);
  const [selectedRiverName, setSelectedRiverName] = useState('Missouri River');
  const [searchFeedback, setSearchFeedback] = useState('Search for a river to jump the map.');
  const [isSearching, setIsSearching] = useState(false);
  const [paddlingSpeedInput, setPaddlingSpeedInput] = useState(DEFAULT_PADDLING_SPEED);
  const [riverCondition, setRiverCondition] = useState<RiverConditionKey>('normal');
  const [travelDirection, setTravelDirection] = useState<TravelDirection>('downstream');
  const insets = useSafeAreaInsets();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<MapView | null>(null);

  const snapPoints = useMemo(() => ['16%', '87%'], []);

  const paddlingSpeed = useMemo(() => {
    const parsed = Number.parseFloat(paddlingSpeedInput);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [paddlingSpeedInput]);

  const coordinatesText = useMemo(() => {
    if (routePoints.length === 0) {
      return 'No path points selected yet.';
    }

    if (routePoints.length === 1) {
      return `Start: ${routePoints[0].latitude.toFixed(5)}, ${routePoints[0].longitude.toFixed(5)}`;
    }

    const start = routePoints[0];
    const end = routePoints[routePoints.length - 1];

    return `Start: ${start.latitude.toFixed(5)}, ${start.longitude.toFixed(5)}  |  End: ${end.latitude.toFixed(5)}, ${end.longitude.toFixed(5)}`;
  }, [routePoints]);

  const routeSummary = useMemo(() => {
    if (routePoints.length < 2 || !paddlingSpeed) {
      return null;
    }

    let totalDistanceMiles = 0;

    for (let index = 0; index < routePoints.length - 1; index += 1) {
      totalDistanceMiles += calculateDistanceMiles(routePoints[index], routePoints[index + 1]);
    }

    const start = routePoints[0];
    const end = routePoints[routePoints.length - 1];
    const currentSpeed = getCurrentSpeed(riverCondition);

    if (!currentSpeed) {
      return null;
    }

    const downstream = calcDownstream(totalDistanceMiles, paddlingSpeed, currentSpeed);
    const upstream = calcUpstream(totalDistanceMiles, paddlingSpeed, currentSpeed);
    const selectedTravel =
      travelDirection === 'downstream'
        ? {
            possible: true as const,
            groundSpeed: downstream.groundSpeed,
            timeFormatted: downstream.timeFormatted,
            timeRangeFormatted: formatTimeRange(downstream.timeHours, TIME_MARGIN_OF_ERROR),
            label: 'Downstream',
          }
        : upstream.possible
          ? {
              possible: true as const,
              groundSpeed: upstream.groundSpeed,
              timeFormatted: upstream.timeFormatted,
              timeRangeFormatted: formatTimeRange(upstream.timeHours, TIME_MARGIN_OF_ERROR),
              label: 'Upstream',
            }
          : {
              possible: false as const,
              message: upstream.message,
              label: 'Upstream',
            };

    return {
      distanceMiles: totalDistanceMiles,
      heading: calculateHeading(start, end),
      waypointCount: Math.max(routePoints.length - 2, 0),
      currentSpeed,
      downstream,
      upstream,
      selectedTravel,
    };
  }, [paddlingSpeed, riverCondition, routePoints, travelDirection]);

  const handleMapPress = ({ nativeEvent }: MapPressEvent) => {
    setRoutePoints((currentPoints) => [...currentPoints, nativeEvent.coordinate]);
  };

  const handleCreateNewPath = () => {
    setRoutePoints([]);
  };

  const handleRiverSearch = async () => {
    const trimmedSearch = search.trim();

    if (!trimmedSearch || isSearching) {
      return;
    }

    setIsSearching(true);
    setSearchFeedback(`Searching for ${trimmedSearch}...`);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(`${trimmedSearch} river`)}`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      const results = (await response.json()) as RiverSearchResult[];
      const bestMatch = results[0];

      if (!bestMatch) {
        setSearchFeedback(`No river results found for "${trimmedSearch}".`);
        return;
      }

      const latitude = Number(bestMatch.lat);
      const longitude = Number(bestMatch.lon);
      const region = {
        latitude,
        longitude,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };

      if (bestMatch.boundingbox?.length === 4) {
        const south = Number(bestMatch.boundingbox[0]);
        const north = Number(bestMatch.boundingbox[1]);
        const west = Number(bestMatch.boundingbox[2]);
        const east = Number(bestMatch.boundingbox[3]);

        region.latitudeDelta = Math.max(Math.abs(north - south) * 1.25, 0.08);
        region.longitudeDelta = Math.max(Math.abs(east - west) * 1.25, 0.08);
      }

      mapRef.current?.animateToRegion(region, 900);
      setSelectedRiverName(bestMatch.display_name.split(',')[0] || trimmedSearch);
      setSearchFeedback(`Showing ${bestMatch.display_name}.`);
    } catch {
      setSearchFeedback('River search is unavailable right now. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Image
            source={require('@/assets/images/RMN Logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <View style={styles.mainPanel}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={INITIAL_REGION}
            onPress={handleMapPress}
            showsCompass
            showsUserLocation
            toolbarEnabled={false}
          >
            {routePoints.map((point, index) => {
              const isStart = index === 0;
              const isEnd = index === routePoints.length - 1;

              return (
                <Marker
                  key={`${point.latitude}-${point.longitude}-${index}`}
                  coordinate={point}
                  title={isStart ? 'Start' : isEnd ? 'End' : `Waypoint ${index}`}
                  description={formatCoordinateLabel(point, index)}
                  pinColor={isStart ? '#14845B' : isEnd ? '#D34D3F' : '#F59E0B'}
                />
              );
            })}

            {routePoints.length >= 2 ? (
              <Polyline
                coordinates={routePoints}
                strokeColor="#155EEF"
                strokeWidth={4}
              />
            ) : null}
          </MapView>

          <View style={styles.searchBar}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={handleRiverSearch}
              placeholder="Search for a river"
              placeholderTextColor="#7A7A7A"
              style={styles.searchInput}
              returnKeyType="search"
              autoCapitalize="words"
            />
            <Pressable
              onPress={handleRiverSearch}
              style={styles.searchButton}
              accessibilityRole="button"
              accessibilityLabel="Search for river"
            >
              {isSearching ? (
                <ActivityIndicator size="small" color="#6F6F6F" />
              ) : (
                <Image
                  source={require('@/assets/images/magnifying-glass.png')}
                  style={styles.searchIcon}
                  resizeMode="contain"
                />
              )}
            </Pressable>
          </View>

          <BottomSheet
            ref={bottomSheetRef}
            index={1}
            snapPoints={snapPoints}
            enableDynamicSizing={false}
            enablePanDownToClose={false}
            style={styles.bottomSheet}
            backgroundStyle={styles.sheetBackground}
            handleIndicatorStyle={styles.handleIndicator}
          >
            <BottomSheetView
              style={[
                styles.sheetContent,
                { paddingBottom: 20 + insets.bottom },
              ]}
            >
              <View style={styles.tripHeader}>
                <Text style={styles.tripTitle}>
                  <Text style={styles.tripTitleBold}>{selectedRiverName}</Text> Planner
                </Text>
                <View style={styles.headerActions}>
                  <Pressable
                    onPress={handleCreateNewPath}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel="Create new path"
                  >
                    <Text style={styles.headerButtonText}>Create New Path</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.titleUnderline} />

              <Text style={styles.coordinates}>{coordinatesText}</Text>

              <View style={styles.speedCard}>
                <Text style={styles.speedLabel}>Paddling speed (mph)</Text>
                <View style={styles.speedInputRow}>
                  <TextInput
                    value={paddlingSpeedInput}
                    onChangeText={setPaddlingSpeedInput}
                    onSubmitEditing={Keyboard.dismiss}
                    style={styles.speedInput}
                    keyboardType="decimal-pad"
                    placeholder="2.1"
                    placeholderTextColor="#9A9A9A"
                    submitBehavior="blurAndSubmit"
                  />
                  <Pressable
                    onPress={Keyboard.dismiss}
                    style={styles.speedDoneButton}
                    accessibilityRole="button"
                    accessibilityLabel="Done editing paddling speed"
                  >
                    <Text style={styles.speedDoneButtonText}>Done</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.controlCard}>
                <Text style={styles.controlLabel}>River current</Text>
                <View style={styles.pillRow}>
                  {(Object.entries(RIVER_CONDITIONS) as [RiverConditionKey, { label: string; speed: number }][]).map(
                    ([key, condition]) => (
                      <Pressable
                        key={key}
                        onPress={() => setRiverCondition(key)}
                        style={[
                          styles.pillButton,
                          riverCondition === key ? styles.pillButtonActive : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillButtonText,
                            riverCondition === key ? styles.pillButtonTextActive : null,
                          ]}
                        >
                          {key}
                        </Text>
                      </Pressable>
                    )
                  )}
                </View>
                <Text style={styles.controlHint}>
                  {RIVER_CONDITIONS[riverCondition].label} at {RIVER_CONDITIONS[riverCondition].speed} mph
                </Text>
              </View>

              <View style={styles.controlCard}>
                <Text style={styles.controlLabel}>Travel direction</Text>
                <View style={styles.pillRow}>
                  {(['downstream', 'upstream'] as TravelDirection[]).map((direction) => (
                    <Pressable
                      key={direction}
                      onPress={() => setTravelDirection(direction)}
                      style={[
                        styles.pillButton,
                        travelDirection === direction ? styles.pillButtonActive : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillButtonText,
                          travelDirection === direction ? styles.pillButtonTextActive : null,
                        ]}
                      >
                        {direction === 'downstream' ? 'Downstream' : 'Upstream'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.infoRow}>
                <Image
                  source={require('@/assets/images/distance.png')}
                  style={styles.infoIcon}
                  resizeMode="contain"
                />
                <Text style={styles.infoText}>
                  {routeSummary
                    ? `${routeSummary.distanceMiles.toFixed(2)} miles with ${routeSummary.waypointCount} waypoint${routeSummary.waypointCount === 1 ? '' : 's'}`
                    : 'Add at least two points to measure distance'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Image
                  source={require('@/assets/images/current-icon.png')}
                  style={styles.infoIcon}
                  resizeMode="contain"
                />
                <Text style={styles.infoText}>
                  {routeSummary
                    ? `${routeSummary.selectedTravel.label} speed ${routeSummary.selectedTravel.possible ? routeSummary.selectedTravel.groundSpeed.toFixed(1) : '0.0'} mph`
                    : routePoints.length > 0
                      ? 'Tap the map to keep adding route points'
                      : searchFeedback}
                </Text>
              </View>

              <Text style={styles.routeStatus}>
                Keep tapping the map to add bends in the route. Use Create New Path to reset it.
              </Text>

              <Text style={styles.estimatedTime}>
                Estimated Time (±30%):{' '}
                <Text
                  style={
                    routeSummary && !routeSummary.selectedTravel.possible
                      ? styles.warningText
                      : undefined
                  }
                >
                  {routeSummary
                    ? routeSummary.selectedTravel.possible
                      ? routeSummary.selectedTravel.timeRangeFormatted
                      : routeSummary.selectedTravel.message
                    : paddlingSpeed
                      ? 'Add at least two path points'
                      : 'Enter a valid paddling speed'}
                </Text>
              </Text>

              <Text style={styles.disclaimerText}>
                Disclaimer: This travel time is an estimate only, and accuracy is not guaranteed.
              </Text>
            </BottomSheetView>
          </BottomSheet>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    height: 80,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 240,
    height: 120,
  },
  mainPanel: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#BDBDBD',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  searchBar: {
    position: 'absolute',
    top: 16,
    left: 18,
    right: 18,
    height: 46,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 14,
    zIndex: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  bottomSheet: {
    zIndex: 20,
    elevation: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1F1F1F',
    paddingVertical: 0,
  },
  searchButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: {
    width: 22,
    height: 22,
    tintColor: '#6F6F6F',
  },
  sheetBackground: {
    backgroundColor: '#F3F3F3',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: '#C6C6C6',
    width: 52,
    height: 5,
  },
  sheetContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
  },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 42,
  },
  tripTitle: {
    fontSize: 18,
    color: '#111111',
    flex: 1,
  },
  tripTitleBold: {
    fontWeight: '700',
  },
  headerActions: {
    justifyContent: 'center',
  },
  headerButton: {
    backgroundColor: '#155EEF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerButtonDisabled: {
    backgroundColor: '#BDBDBD',
  },
  headerButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  titleUnderline: {
    height: 2,
    backgroundColor: '#111111',
    marginTop: 6,
    marginBottom: 6,
    width: '100%',
  },
  coordinates: {
    fontSize: 11,
    color: '#8A8A8A',
    fontStyle: 'italic',
    marginBottom: 10,
    lineHeight: 16,
  },
  speedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E3E3E3',
  },
  speedLabel: {
    fontSize: 13,
    color: '#5F5F5F',
    marginBottom: 8,
    fontWeight: '600',
  },
  speedInput: {
    flex: 1,
    fontSize: 20,
    color: '#111111',
    paddingVertical: 0,
  },
  speedInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  speedDoneButton: {
    backgroundColor: '#E7EEFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  speedDoneButtonText: {
    color: '#155EEF',
    fontSize: 12,
    fontWeight: '700',
  },
  controlCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E3E3E3',
  },
  controlLabel: {
    fontSize: 13,
    color: '#5F5F5F',
    marginBottom: 8,
    fontWeight: '600',
  },
  controlHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#7A7A7A',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pillButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C8D4FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  pillButtonActive: {
    backgroundColor: '#155EEF',
    borderColor: '#155EEF',
  },
  pillButtonText: {
    color: '#155EEF',
    fontSize: 12,
    fontWeight: '700',
  },
  pillButtonTextActive: {
    color: '#FFFFFF',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingRight: 12,
  },
  infoIcon: {
    width: 28,
    height: 28,
    marginRight: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 17,
    color: '#111111',
  },
  routeStatus: {
    fontSize: 13,
    lineHeight: 18,
    color: '#7A7A7A',
    marginTop: 0,
    marginBottom: 6,
  },
  estimatedTime: {
    marginTop: 4,
    fontSize: 14,
    color: '#111111',
    fontStyle: 'italic',
    fontWeight: '600',
  },
  warningText: {
    color: '#C62828',
  },
  disclaimerText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
    color: '#7A7A7A',
    fontStyle: 'italic',
  },
});
