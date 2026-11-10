import { Room } from '../core/api';

export const fallbackRoomPhoto = '/photos/room.jpg';

const roomPhotos: Record<string, string> = {
  'Deluxe Room': '/photos/deluxe.jpg',
  'Executive Suite': '/photos/suite.jpg',
};

export function roomPhotosFor(room: Room) {
  if (!room.images.length) return [roomPhotos[room.room_type.name] ?? fallbackRoomPhoto];
  return [...room.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map(photo => photo.image);
}

export function imageFallback(event: Event) {
  const image = event.target as HTMLImageElement;
  if (image.getAttribute('src') !== fallbackRoomPhoto) image.src = fallbackRoomPhoto;
}
