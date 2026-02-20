use std::sync::Arc;

use bytes::Bytes;
use dashmap::DashMap;
use tokio::sync::{mpsc, Mutex, Notify};
use tracing::{debug, info, warn};

use paracord_transport::protocol::{MediaHeader, HEADER_SIZE};

use crate::room::MediaRoomManager;
use crate::speaker::SpeakerDetector;

/// Transport abstraction for relay connections.
/// Raw QUIC is used for Tauri desktop and federation; channel-bridged
/// connections are used for WebTransport browser clients.
enum MediaTransport {
    /// Raw QUIC (Tauri desktop, federation).
    Quic(quinn::Connection),
    /// Channel-bridged (WebTransport browser clients).
    /// The bridge task translates between HTTP/3 datagrams (with QSID
    /// framing) and raw media packets.
    Bridged {
        outbound_tx: mpsc::UnboundedSender<Bytes>,
        inbound_rx: Arc<Mutex<mpsc::UnboundedReceiver<Bytes>>>,
    },
}

impl Clone for MediaTransport {
    fn clone(&self) -> Self {
        match self {
            Self::Quic(conn) => Self::Quic(conn.clone()),
            Self::Bridged {
                outbound_tx,
                inbound_rx,
            } => Self::Bridged {
                outbound_tx: outbound_tx.clone(),
                inbound_rx: Arc::clone(inbound_rx),
            },
        }
    }
}

/// Handle to a connected participant's QUIC connection for datagram forwarding.
#[derive(Clone)]
pub struct ConnectionHandle {
    pub user_id: i64,
    pub room_id: String,
    transport: MediaTransport,
}

impl ConnectionHandle {
    /// Create a handle wrapping a raw QUIC connection.
    pub fn new(user_id: i64, room_id: String, conn: quinn::Connection) -> Self {
        Self {
            user_id,
            room_id,
            transport: MediaTransport::Quic(conn),
        }
    }

    /// Create a handle wrapping a channel-bridged WebTransport connection.
    pub fn new_bridged(
        user_id: i64,
        room_id: String,
        outbound_tx: mpsc::UnboundedSender<Bytes>,
        inbound_rx: mpsc::UnboundedReceiver<Bytes>,
    ) -> Self {
        Self {
            user_id,
            room_id,
            transport: MediaTransport::Bridged {
                outbound_tx,
                inbound_rx: Arc::new(Mutex::new(inbound_rx)),
            },
        }
    }

    /// Send a datagram to this connection.
    pub fn send_datagram(&self, data: Bytes) -> Result<(), quinn::SendDatagramError> {
        match &self.transport {
            MediaTransport::Quic(conn) => conn.send_datagram(data),
            MediaTransport::Bridged { outbound_tx, .. } => {
                outbound_tx
                    .send(data)
                    .map_err(|_| quinn::SendDatagramError::ConnectionLost(
                        quinn::ConnectionError::LocallyClosed,
                    ))
            }
        }
    }

    /// Read a datagram from this connection.
    pub async fn read_datagram(&self) -> Result<Bytes, quinn::ConnectionError> {
        match &self.transport {
            MediaTransport::Quic(conn) => conn.read_datagram().await,
            MediaTransport::Bridged { inbound_rx, .. } => {
                let mut rx = inbound_rx.lock().await;
                rx.recv()
                    .await
                    .ok_or(quinn::ConnectionError::LocallyClosed)
            }
        }
    }

    /// Check if the connection is still alive.
    pub fn is_alive(&self) -> bool {
        match &self.transport {
            MediaTransport::Quic(conn) => conn.close_reason().is_none(),
            MediaTransport::Bridged { outbound_tx, .. } => !outbound_tx.is_closed(),
        }
    }
}

/// The relay forwarder manages connections and forwards media packets between
/// participants in the same room based on their subscriptions.
///
/// It never inspects or decrypts the encrypted payload -- it only reads the
/// cleartext 16-byte MediaHeader to determine routing and audio level.
pub struct RelayForwarder {
    /// Map of user_id -> ConnectionHandle for active connections.
    connections: DashMap<i64, ConnectionHandle>,
    /// Room manager for subscription lookups.
    room_manager: Arc<MediaRoomManager>,
    /// Speaker detector for audio level tracking.
    speaker_detector: Arc<SpeakerDetector>,
    /// Notify signal for shutdown.
    shutdown: Notify,
}

impl RelayForwarder {
    pub fn new(
        room_manager: Arc<MediaRoomManager>,
        speaker_detector: Arc<SpeakerDetector>,
    ) -> Self {
        Self {
            connections: DashMap::new(),
            room_manager,
            speaker_detector,
            shutdown: Notify::new(),
        }
    }

    /// Register a new participant connection for relay forwarding.
    pub fn add_connection(&self, handle: ConnectionHandle) {
        let user_id = handle.user_id;
        let room_id = handle.room_id.clone();
        info!(user_id, room_id = %room_id, "relay: participant connected");
        self.connections.insert(user_id, handle);
    }

    /// Remove a participant's connection.
    pub fn remove_connection(&self, user_id: i64) {
        if self.connections.remove(&user_id).is_some() {
            info!(user_id, "relay: participant disconnected");
        }
    }

    /// Spawn the forwarding loop for a single participant.
    /// This task reads datagrams from the participant and forwards them
    /// to all subscribed recipients.
    pub fn spawn_forwarding_task(self: &Arc<Self>, handle: ConnectionHandle) {
        let forwarder = Arc::clone(self);
        let user_id = handle.user_id;
        let room_id = handle.room_id.clone();

        tokio::spawn(async move {
            info!(user_id, room_id = %room_id, "relay: forwarding task started");

            loop {
                let datagram = tokio::select! {
                    result = handle.read_datagram() => {
                        match result {
                            Ok(data) => data,
                            Err(e) => {
                                debug!(user_id, error = %e, "relay: connection closed");
                                break;
                            }
                        }
                    }
                    _ = forwarder.shutdown.notified() => {
                        debug!(user_id, "relay: shutdown signal received");
                        break;
                    }
                };

                if datagram.len() < HEADER_SIZE {
                    warn!(user_id, len = datagram.len(), "relay: datagram too short, dropping");
                    continue;
                }

                // Parse the header (read-only, we never modify it)
                let header = match MediaHeader::decode(&mut &datagram[..HEADER_SIZE]) {
                    Ok(h) => h,
                    Err(e) => {
                        warn!(user_id, error = %e, "relay: invalid header, dropping");
                        continue;
                    }
                };

                // Feed audio level to speaker detector
                forwarder
                    .speaker_detector
                    .report_audio_level(user_id, &room_id, header.audio_level);

                // Look up the sender's room and find subscribers
                forwarder.forward_to_subscribers(user_id, &room_id, &datagram);
            }

            // Clean up on disconnect
            forwarder.remove_connection(user_id);
            info!(user_id, room_id = %room_id, "relay: forwarding task ended");
        });
    }

    /// Forward a complete packet (header + encrypted payload) to all subscribers.
    fn forward_to_subscribers(&self, sender_id: i64, room_id: &str, packet: &Bytes) {
        let room = match self.room_manager.get_room(room_id) {
            Some(r) => r,
            None => return,
        };

        // Find all participants subscribed to this sender
        let mut forward_count = 0u32;
        for (_, participant) in &room.participants {
            if participant.user_id == sender_id {
                continue;
            }
            if participant.deafened {
                continue;
            }
            if !participant.subscriptions.contains(&sender_id) {
                continue;
            }

            // Look up the recipient's connection handle
            if let Some(recipient_conn) = self.connections.get(&participant.user_id) {
                if let Err(e) = recipient_conn.send_datagram(packet.clone()) {
                    debug!(
                        sender = sender_id,
                        recipient = participant.user_id,
                        error = %e,
                        "relay: failed to forward datagram"
                    );
                }
                forward_count += 1;
            }
        }

        if forward_count > 0 {
            debug!(
                sender = sender_id,
                recipients = forward_count,
                "relay: forwarded datagram"
            );
        }
    }

    /// Signal shutdown to all forwarding tasks.
    pub fn shutdown(&self) {
        self.shutdown.notify_waiters();
    }

    /// Get the number of active connections.
    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_handle_creation() {
        // We can't easily test with real quinn connections in unit tests,
        // but we can verify the struct construction.
        let mgr = MediaRoomManager::new();
        let forwarder = RelayForwarder::new(
            Arc::new(mgr),
            Arc::new(SpeakerDetector::new()),
        );
        assert_eq!(forwarder.connection_count(), 0);
    }
}
