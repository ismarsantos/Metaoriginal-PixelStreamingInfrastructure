// Copyright Epic Games, Inc. All Rights Reserved.
import {
    ITransport,
    SignallingProtocol,
    Messages,
    MessageHelpers,
    BaseMessage,
    EventEmitter
} from '@epicgames-ps/lib-pixelstreamingcommon-ue5.7';
import { Logger } from './Logger';
import { IMessageLogger } from './LoggingUtils';
import { IPlayerInfo } from './PlayerRegistry';

/**
 * An interface that describes a streamer that can be added to the
 * streamer registry.
 */
export interface IStreamer extends EventEmitter, IMessageLogger {
    streamerId: string;
    transport: ITransport;
    protocol: SignallingProtocol;
    streaming: boolean;
    maxSubscribers: number;
    subscribers: Set<string>;

    sendMessage(message: BaseMessage): void;
    getStreamerInfo(): IStreamerInfo;
}

/**
 * Used by the API to describe a streamer.
 */
export interface IStreamerInfo {
    streamerId: string;
    type: string;
    streaming: boolean;
    remoteAddress: string | undefined;
    subscribers: IPlayerInfo[];
}

/**
 * Handles all the streamer connections of a signalling server and
 * can be used to lookup connections by id etc.
 * Fires events when streamers are added or removed.
 * Events:
 *   'added': (playerId: string) Player was added.
 *   'removed': (playerId: string) Player was removed.
 */
export class StreamerRegistry extends EventEmitter {
    streamers: IStreamer[];
    defaultStreamerIdPrefix: string = 'UnknownStreamer';

    constructor() {
        super();
        this.streamers = [];
    }

    /**
     * Adds a streamer to the registry. If the streamer already has an id
     * it will be sanitized (checked against existing ids and altered if
     * there are collisions), or if it has no id it will be assigned a
     * default unique id.
     * @returns True if the add was successful.
     */
    add(streamer: IStreamer): boolean {
        streamer.streamerId = this.sanitizeStreamerId(streamer.streamerId);

        if (this.find(streamer.streamerId)) {
            Logger.error(
                `StreamerRegistry: Tried to register streamer ${streamer.streamerId} but that id already exists.`
            );
            return false;
        }

        this.streamers.push(streamer);

        // request that the new streamer id itself.
        streamer.protocol.on(Messages.endpointId.typeName, this.onEndpointId.bind(this, streamer));
        streamer.sendMessage(MessageHelpers.createMessage(Messages.identify));

        this.emit('added', streamer.streamerId);

        return true;
    }

    /**
     * Removes a streamer from the registry. If the streamer isn't found
     * it does nothing.
     * @returns True if the streamer was removed.
     */
    remove(streamer: IStreamer): boolean {
        const index = this.streamers.indexOf(streamer);
        if (index === -1) {
            Logger.debug(
                `StreamerRegistry: Tried to remove streamer ${streamer.streamerId} but it doesn't exist`
            );
            return false;
        }
        this.streamers.splice(index, 1);
        this.emit('removed', streamer.streamerId);
        return true;
    }

    /**
     * Attempts to find the given streamer id in the registry.
     */
    find(streamerId: string): IStreamer | undefined {
        return this.streamers.find((streamer) => streamer.streamerId === streamerId);
    }

    /**
     * Used by players who haven't subscribed but try to send a message.
     * This is to cover legacy connections that do not know how to subscribe.
     * The player will be assigned the first streamer in the list.
     * @returns The first streamerId in the registry or null if there are none.
     */
    getFirstStreamerId(): string | null {
        if (this.empty()) {
            return null;
        }
        return this.streamers[0].streamerId;
    }

    /**
     * Returns true when the registry is empty.
     */
    empty(): boolean {
        return this.streamers.length === 0;
    }

    /**
     * Returns the total number of connected streamers.
     */
    count(): number {
        return this.streamers.length;
    }

    private onEndpointId(streamer: IStreamer, message: Messages.endpointId): void {
        const oldId = streamer.streamerId;

        // Evict any stale ghost(s) that already hold the requested id. This happens
        // when a streamer crashes/reconnects before its old WebSocket close fires,
        // leaving a zombie registration behind. "Last write wins": the freshly
        // connected streamer claims the id and the dead one is forced off.
        const ghosts = this.streamers.filter(
            (existing) => existing !== streamer && existing.streamerId === message.id
        );
        for (const ghost of ghosts) {
            Logger.warn(
                `StreamerRegistry: Evicting ghost streamer "${message.id}" — duplicate reconnect detected.`
            );
            this.remove(ghost);
            ghost.transport.disconnect();
        }

        // Sanitize against the remaining ids, excluding this streamer's own slot
        // so that re-identifying with the same id doesn't bump it to "<id>1".
        streamer.streamerId = this.sanitizeStreamerId(message.id, streamer);

        Logger.debug(`StreamerRegistry: Streamer id change. ${oldId} -> ${streamer.streamerId}`);
        streamer.emit('id_changed', streamer.streamerId);

        // because we might have sanitized the id, we confirm the id back to the streamer
        streamer.sendMessage(
            MessageHelpers.createMessage(Messages.endpointIdConfirm, { committedId: streamer.streamerId })
        );
    }

    private sanitizeStreamerId(id: string, exclude?: IStreamer): string {
        // create a default id if none supplied
        if (!id) {
            id = this.defaultStreamerIdPrefix;
        }

        // A candidate id is taken if any OTHER streamer (never the excluded one)
        // already holds it. Excluding self lets a streamer re-identify with the
        // same id without being bumped to "<id>1".
        const taken = (candidate: string): boolean =>
            this.streamers.some((streamer) => streamer !== exclude && streamer.streamerId === candidate);

        // Fast path: the exact id is free.
        if (!taken(id)) {
            return id;
        }

        // Append the lowest free numeric suffix. The previous regex-based approach
        // (/^(.*?)(\d*)$/) silently failed to deconflict ids that already end in
        // digits (e.g. "stream03"), allowing two entries with the same id.
        let counter = 1;
        while (taken(`${id}${counter}`)) {
            counter++;
        }
        return `${id}${counter}`;
    }
}
