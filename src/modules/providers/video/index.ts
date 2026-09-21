export interface VideoRoom {
  roomId: string;
  isMock: boolean;
}

export interface VideoProvider {
  readonly name: string;
  createRoom(videoSessionId: string): Promise<VideoRoom>;
}

/** No real RTC in the MVP. The room is a page that says so. */
export class MockVideoProvider implements VideoProvider {
  readonly name = "mock";

  async createRoom(videoSessionId: string): Promise<VideoRoom> {
    return { roomId: `mock-room-${videoSessionId}`, isMock: true };
  }
}

let instance: VideoProvider | null = null;

export function videoProvider(): VideoProvider {
  if (!instance) instance = new MockVideoProvider();
  return instance;
}
