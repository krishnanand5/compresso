import type { ArtifactRecord } from './artifact-store.js';

interface ListNode {
  key: string;
  value: ArtifactRecord;
  prev: ListNode | null;
  next: ListNode | null;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  capacity: number;
}

export class HotCache {
  private capacity: number;
  private map: Map<string, ListNode>;
  private head: ListNode;
  private tail: ListNode;
  private hits = 0;
  private misses = 0;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = { key: '', value: null as any, prev: null, next: null };
    this.tail = { key: '', value: null as any, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get(key: string): ArtifactRecord | undefined {
    const node = this.map.get(key);
    if (!node) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.promote(node);
    return node.value;
  }

  set(key: string, value: ArtifactRecord): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.promote(existing);
      return;
    }

    const node: ListNode = { key, value, prev: null, next: null };
    this.map.set(key, node);
    this.insertAfterHead(node);

    if (this.map.size > this.capacity) {
      const evicted = this.removeTail();
      if (evicted) this.map.delete(evicted.key);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): void {
    const node = this.map.get(key);
    if (!node) return;
    this.unlink(node);
    this.map.delete(key);
  }

  clear(): void {
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.map.clear();
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.map.size,
      capacity: this.capacity,
    };
  }

  private promote(node: ListNode): void {
    this.unlink(node);
    this.insertAfterHead(node);
  }

  private insertAfterHead(node: ListNode): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private unlink(node: ListNode): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private removeTail(): ListNode | null {
    if (this.tail.prev === this.head) return null;
    const node = this.tail.prev!;
    this.unlink(node);
    return node;
  }
}
