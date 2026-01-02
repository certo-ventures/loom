/**
 * DeliberationRoom - Multi-actor decision discussion and collaboration
 * 
 * Enables teams, committees, and hybrid AI+human groups to deliberate
 * on decisions together with full auditability.
 * 
 * Features:
 * - Real-time and async collaboration
 * - Message history and threading
 * - Argument submission with evidence
 * - Participant management and roles
 * - Integration with consensus voting
 * - Complete audit trail
 */

import { ActorMemory } from './actor-memory';
import type { MemoryStorage } from './types';
import type { LamportClock } from '../../timing/lamport-clock';

/**
 * Deliberation room configuration
 */
export interface RoomConfig {
  name: string;
  description: string;
  decisionType: string;
  mode: 'sync' | 'async';
  creatorId: string;
  context: Record<string, any>;
  timeout?: number; // milliseconds for sync mode
  maxParticipants?: number;
}

/**
 * Participant in a deliberation room
 */
export interface Participant {
  actorId: string;
  role: ParticipantRole;
  joinedAt: number;
  lastActiveAt: number;
  isActive: boolean;
  metadata?: Record<string, any>;
}

/**
 * Participant roles with different permissions
 */
export type ParticipantRole = 
  | 'moderator'      // Can manage room, remove participants
  | 'contributor'    // Can post messages and arguments
  | 'voter'          // Can vote but not post
  | 'observer';      // Read-only access

/**
 * Message in a deliberation room
 */
export interface Message {
  id: string;
  roomId: string;
  authorId: string;
  content: string;
  messageType: 'comment' | 'question' | 'proposal' | 'summary';
  timestamp: number;
  replyToId?: string; // For threading
  reactions?: Record<string, string[]>; // emoji -> actorIds
  metadata?: Record<string, any>;
}

/**
 * Argument for or against a decision
 */
export interface Argument {
  id: string;
  roomId: string;
  authorId: string;
  position: 'for' | 'against' | 'neutral';
  title: string;
  content: string;
  evidence: Evidence[];
  strength: number; // 0-1, credibility score
  supportsArgumentId?: string;
  opposesArgumentId?: string;
  timestamp: number;
}

/**
 * Evidence supporting an argument
 */
export interface Evidence {
  id: string;
  type: 'data' | 'precedent' | 'policy' | 'expert_opinion' | 'external_source';
  content: string;
  source: string;
  reliability: number; // 0-1
  metadata?: Record<string, any>;
}

/**
 * Complete conversation history
 */
export interface Conversation {
  roomId: string;
  messages: Message[];
  arguments: Argument[];
  participants: Participant[];
  summary?: string;
}

/**
 * Room outcome when closed
 */
export interface RoomOutcome {
  decision?: any;
  consensus: 'reached' | 'not_reached' | 'timed_out';
  closedBy: string;
  closedAt: number;
  summary: string;
  voteId?: string; // Link to ConsensusEngine vote if voting occurred
}

/**
 * Room status and metadata
 */
export interface Room {
  id: string;
  config: RoomConfig;
  participants: Participant[];
  createdAt: number;
  closedAt?: number;
  status: 'open' | 'closed' | 'archived';
  outcome?: RoomOutcome;
  messageCount: number;
  argumentCount: number;
}

/**
 * DeliberationRoom class - Manages multi-actor decision discussions
 */
export class DeliberationRoom extends ActorMemory {
  private rooms: Map<string, Room>;

  constructor(
    actorId: string,
    storage: MemoryStorage,
    clock: LamportClock
  ) {
    super(actorId, storage, clock);
    this.rooms = new Map();
  }

  /**
   * Create a new deliberation room
   */
  async createRoom(config: RoomConfig): Promise<string> {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8); // Add randomness to prevent collisions
    const roomId = `room:${config.decisionType}:${timestamp}:${random}`;
    
    const room: Room = {
      id: roomId,
      config,
      participants: [{
        actorId: config.creatorId,
        role: 'moderator',
        joinedAt: Date.now(),
        lastActiveAt: Date.now(),
        isActive: true
      }],
      createdAt: Date.now(),
      status: 'open',
      messageCount: 0,
      argumentCount: 0
    };

    // Store in memory graph
    const entityId = await this.addEntity(
      roomId,
      'deliberation-room',
      config.description,
      {
        metadata: {
          decisionType: config.decisionType,
          mode: config.mode,
          creatorId: config.creatorId
        }
      }
    );

    await this.addFact(
      entityId,
      'has_room_data',
      entityId,
      JSON.stringify(room),
      {
        source: 'deliberation-system' as any,
        confidence: 1.0,
        metadata: { status: 'open' }
      }
    );

    // Cache the room
    this.rooms.set(roomId, room);

    return roomId;
  }

  /**
   * Add participant to a room
   */
  async addParticipant(
    roomId: string,
    actorId: string,
    role: ParticipantRole
  ): Promise<void> {
    const room = await this.getRoom(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.status !== 'open') {
      throw new Error(`Room ${roomId} is ${room.status}`);
    }

    // Check max participants
    if (room.config.maxParticipants && 
        room.participants.length >= room.config.maxParticipants) {
      throw new Error(`Room ${roomId} is full`);
    }

    // Check if already a participant
    if (room.participants.some(p => p.actorId === actorId)) {
      throw new Error(`Actor ${actorId} is already in room ${roomId}`);
    }

    const participant: Participant = {
      actorId,
      role,
      joinedAt: Date.now(),
      lastActiveAt: Date.now(),
      isActive: true
    };

    room.participants.push(participant);
    this.rooms.set(roomId, room);

    // Update in storage
    await this.updateRoomInStorage(room);

    // Record fact about participation
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId);
    
    if (roomEntity) {
      await this.addFact(
        roomEntity.id,
        'has_participant',
        actorId,
        `${actorId} joined as ${role}`,
        {
          source: 'deliberation-system' as any,
          confidence: 1.0,
          metadata: { role, joinedAt: participant.joinedAt }
        }
      );
    }
  }

  /**
   * Post a message to the room
   */
  async postMessage(roomId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<string> {
    const room = await this.getRoom(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.status !== 'open') {
      throw new Error(`Room ${roomId} is ${room.status}`);
    }

    // Verify participant
    const participant = room.participants.find(p => p.actorId === message.authorId);
    if (!participant) {
      throw new Error(`Actor ${message.authorId} is not a participant in room ${roomId}`);
    }

    // Check permissions
    if (participant.role === 'observer') {
      throw new Error(`Observers cannot post messages`);
    }

    const messageId = `msg:${roomId}:${Date.now()}`;
    const completeMessage: Message = {
      ...message,
      id: messageId,
      timestamp: Date.now(),
      reactions: {}
    };

    // Update participant activity
    participant.lastActiveAt = Date.now();
    room.messageCount++;
    this.rooms.set(roomId, room);

    // Store message as fact
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId);
    
    if (roomEntity) {
      await this.addFact(
        roomEntity.id,
        'has_message',
        messageId,
        JSON.stringify(completeMessage),
        {
          source: 'user_input' as any,
          confidence: 1.0,
          metadata: { 
            messageType: message.messageType,
            replyToId: message.replyToId 
          }
        }
      );
    }

    await this.updateRoomInStorage(room);

    return messageId;
  }

  /**
   * Submit an argument (for/against/neutral position)
   */
  async submitArgument(roomId: string, argument: Omit<Argument, 'id' | 'timestamp'>): Promise<string> {
    const room = await this.getRoom(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.status !== 'open') {
      throw new Error(`Room ${roomId} is ${room.status}`);
    }

    // Verify participant
    const participant = room.participants.find(p => p.actorId === argument.authorId);
    if (!participant) {
      throw new Error(`Actor ${argument.authorId} is not a participant in room ${roomId}`);
    }

    // Check permissions
    if (participant.role === 'observer' || participant.role === 'voter') {
      throw new Error(`Only contributors and moderators can submit arguments`);
    }

    const argumentId = `arg:${roomId}:${Date.now()}`;
    const completeArgument: Argument = {
      ...argument,
      id: argumentId,
      timestamp: Date.now()
    };

    // Update participant activity
    participant.lastActiveAt = Date.now();
    room.argumentCount++;
    this.rooms.set(roomId, room);

    // Store argument as fact
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId);
    
    if (roomEntity) {
      await this.addFact(
        roomEntity.id,
        'has_argument',
        argumentId,
        JSON.stringify(completeArgument),
        {
          source: 'user_input' as any,
          confidence: argument.strength,
          metadata: { 
            position: argument.position,
            evidenceCount: argument.evidence.length
          }
        }
      );
    }

    await this.updateRoomInStorage(room);

    return argumentId;
  }

  /**
   * Submit evidence for an argument
   */
  async submitEvidence(
    roomId: string,
    argumentId: string,
    evidence: Evidence
  ): Promise<void> {
    const room = await this.getRoom(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    // Get the argument
    const argument = await this.getArgument(roomId, argumentId);
    if (!argument) {
      throw new Error(`Argument ${argumentId} not found`);
    }

    // Add evidence to argument
    argument.evidence.push(evidence);

    // Update argument in storage
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId);
    
    if (roomEntity) {
      await this.addFact(
        roomEntity.id,
        'has_evidence',
        evidence.id,
        JSON.stringify(evidence),
        {
          source: 'deliberation-system' as any,
          confidence: evidence.reliability,
          metadata: { 
            argumentId,
            evidenceType: evidence.type
          }
        }
      );
    }
  }

  /**
   * Get complete conversation history
   */
  async getConversation(roomId: string): Promise<Conversation> {
    const room = await this.getRoom(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const messages = await this.getMessages(roomId);
    const roomArguments = await this.getArguments(roomId);

    return {
      roomId,
      messages,
      arguments: roomArguments,
      participants: room.participants,
      summary: room.outcome?.summary
    };
  }

  /**
   * Close a deliberation room
   */
  async closeRoom(roomId: string, outcome: RoomOutcome): Promise<void> {
    const room = await this.getRoom(roomId);
    
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.status !== 'open') {
      throw new Error(`Room ${roomId} is already ${room.status}`);
    }

    // Verify closer is moderator
    const closer = room.participants.find(p => p.actorId === outcome.closedBy);
    if (!closer || closer.role !== 'moderator') {
      throw new Error(`Only moderators can close rooms`);
    }

    room.status = 'closed';
    room.closedAt = outcome.closedAt;
    room.outcome = outcome;

    this.rooms.set(roomId, room);

    // Update in storage
    await this.updateRoomInStorage(room);

    // Record closure fact
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId);
    
    if (roomEntity) {
      await this.addFact(
        roomEntity.id,
        'room_closed',
        roomEntity.id,
        JSON.stringify(outcome),
        {
          source: 'user_input' as any,
          confidence: 1.0,
          metadata: { 
            consensus: outcome.consensus,
            closedAt: outcome.closedAt
          }
        }
      );
    }
  }

  /**
   * Get room by ID
   */
  async getRoom(roomId: string): Promise<Room | null> {
    // Load from storage (no caching to ensure fresh data)
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId && e.type === 'deliberation-room');
    
    if (!roomEntity) {
      return null;
    }

    const facts = await this.getCurrentFacts();
    // Get all room data facts and find the most recent one (highest lamport timestamp)
    const roomFacts = facts.filter(
      f => f.relation === 'has_room_data' && f.sourceEntityId === roomEntity.id
    ).sort((a, b) => b.lamport_ts - a.lamport_ts);

    if (roomFacts.length === 0) {
      return null;
    }

    try {
      return JSON.parse(roomFacts[0].text);
    } catch {
      return null;
    }
  }

  /**
   * List all rooms (optionally filter by status)
   */
  async listRooms(status?: 'open' | 'closed' | 'archived'): Promise<Room[]> {
    const entities = await this.getEntities();
    const roomEntities = entities.filter(e => e.type === 'deliberation-room');
    
    const facts = await this.getCurrentFacts();
    const rooms: Room[] = [];

    for (const entity of roomEntities) {
      // Get all room data facts for this entity and find the most recent one
      const roomFacts = facts.filter(
        f => f.relation === 'has_room_data' && f.sourceEntityId === entity.id
      ).sort((a, b) => b.lamport_ts - a.lamport_ts);

      if (roomFacts.length > 0) {
        try {
          const room = JSON.parse(roomFacts[0].text);
          if (!status || room.status === status) {
            rooms.push(room);
          }
        } catch {
          // Skip invalid data
        }
      }
    }

    return rooms;
  }

  /**
   * Get messages from a room
   */
  private async getMessages(roomId: string): Promise<Message[]> {
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId);
    
    if (!roomEntity) {
      return [];
    }

    const facts = await this.getCurrentFacts();
    const messageFacts = facts.filter(
      f => f.relation === 'has_message' && f.sourceEntityId === roomEntity.id
    );

    const messages: Message[] = [];
    for (const fact of messageFacts) {
      try {
        messages.push(JSON.parse(fact.text));
      } catch {
        // Skip invalid messages
      }
    }

    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get arguments from a room
   */
  private async getArguments(roomId: string): Promise<Argument[]> {
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === roomId);
    
    if (!roomEntity) {
      return [];
    }

    const facts = await this.getCurrentFacts();
    const argumentFacts = facts.filter(
      f => f.relation === 'has_argument' && f.sourceEntityId === roomEntity.id
    );

    const roomArguments: Argument[] = [];
    for (const fact of argumentFacts) {
      try {
        roomArguments.push(JSON.parse(fact.text));
      } catch {
        // Skip invalid arguments
      }
    }

    return roomArguments.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get a specific argument
   */
  private async getArgument(roomId: string, argumentId: string): Promise<Argument | null> {
    const roomArguments = await this.getArguments(roomId);
    return roomArguments.find(a => a.id === argumentId) || null;
  }

  /**
   * Update room in storage
   */
  private async updateRoomInStorage(room: Room): Promise<void> {
    const entities = await this.getEntities();
    const roomEntity = entities.find(e => e.name === room.id);
    
    if (roomEntity) {
      await this.addFact(
        roomEntity.id,
        'has_room_data',
        roomEntity.id,
        JSON.stringify(room),
        {
          source: 'deliberation-system' as any as any,
          confidence: 1.0,
          metadata: { 
            status: room.status,
            updatedAt: Date.now()
          }
        }
      );
    }

    // Update cache to keep it in sync
    this.rooms.set(room.id, room);
  }
}
