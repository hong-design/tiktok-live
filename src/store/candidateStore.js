const MAX_SIZE = 200;

export class CandidateStore {
  constructor() {
    this._items = [];
    this._nextId = 0;
  }

  add(record) {
    if (this._items.length >= MAX_SIZE) {
      this._items.shift();
    }
    this._items.push({ id: this._nextId++, ...record });
  }

  getAll() {
    return [...this._items].reverse();
  }

  accept(id, songStore) {
    const idx = this._items.findIndex((item) => item.id === id);
    if (idx === -1) return null;
    const [item] = this._items.splice(idx, 1);
    if (songStore && item.normalizedCandidate) {
      songStore.increment(
        { song: item.candidateSong, normalizedSong: item.normalizedCandidate },
        item.comment,
        item.timestamp
      );
    }
    return item;
  }

  reject(id) {
    const idx = this._items.findIndex((item) => item.id === id);
    if (idx !== -1) this._items.splice(idx, 1);
  }
}
