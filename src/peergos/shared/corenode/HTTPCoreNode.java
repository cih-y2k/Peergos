
package peergos.shared.corenode;
import java.util.logging.*;

import peergos.shared.cbor.*;
import peergos.shared.crypto.asymmetric.*;
import peergos.shared.crypto.hash.*;
import peergos.shared.io.ipfs.api.*;
import peergos.shared.io.ipfs.cid.*;
import peergos.shared.io.ipfs.multihash.*;
import peergos.shared.merklebtree.*;
import peergos.shared.user.*;
import peergos.shared.util.*;

import java.net.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public class HTTPCoreNode implements CoreNodeProxy {
	private static final Logger LOG = Logger.getGlobal();
	private static final String P2P_PROXY_PROTOCOL = "http";

    private final HttpPoster direct, p2p;

    public HTTPCoreNode(HttpPoster direct, HttpPoster p2p)
    {
        LOG.info("Creating HTTP Corenode API at " + direct + " and " + p2p);
        this.direct = direct;
        this.p2p = p2p;
    }

    private static String getProxyUrlPrefix(Multihash targetId) {
        return "/http/proxy/" + targetId.toBase58() + "/" + P2P_PROXY_PROTOCOL + "/";
    }

    @Override
    public CompletableFuture<Optional<PublicKeyHash>> getPublicKeyHash(String username) {
        return getPublicKeyHash("", direct, username);
    }

    @Override
    public CompletableFuture<Optional<PublicKeyHash>> getPublicKeyHash(Multihash targetServerId, String username) {
        return getPublicKeyHash(getProxyUrlPrefix(targetServerId), p2p, username);
    }

    public CompletableFuture<Optional<PublicKeyHash>> getPublicKeyHash(String urlPrefix, HttpPoster poster, String username) {
        try {
            ByteArrayOutputStream bout = new ByteArrayOutputStream();
            DataOutputStream dout = new DataOutputStream(bout);

            Serialize.serialize(username, dout);
            dout.flush();

            CompletableFuture<byte[]> fut = poster.postUnzip(urlPrefix + "core/getPublicKey", bout.toByteArray());
            return fut.thenApply(res -> {
                DataInputStream din = new DataInputStream(new ByteArrayInputStream(res));

                try {
                    if (!din.readBoolean())
                        return Optional.empty();
                    byte[] publicKey = CoreNodeUtils.deserializeByteArray(din);
                    return Optional.of(PublicKeyHash.fromCbor(CborObject.fromByteArray(publicKey)));
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            });
        } catch (IOException ioe) {
            LOG.log(Level.WARNING, ioe.getMessage(), ioe);
            return CompletableFuture.completedFuture(Optional.empty());
        }
    }

    @Override
    public CompletableFuture<String> getUsername(PublicKeyHash owner) {
        return getUsername("", direct, owner);
    }

    @Override
    public CompletableFuture<String> getUsername(Multihash targetServerId, PublicKeyHash owner) {
        return getUsername(getProxyUrlPrefix(targetServerId), p2p, owner);
    }

    public CompletableFuture<String> getUsername(String urlPrefix, HttpPoster poster, PublicKeyHash owner) {
        try
        {
            ByteArrayOutputStream bout = new ByteArrayOutputStream();
            DataOutputStream dout = new DataOutputStream(bout);

            Serialize.serialize(owner.serialize(), dout);
            dout.flush();
            CompletableFuture<byte[]> fut = poster.post(urlPrefix + "core/getUsername", bout.toByteArray(), true);
            return fut.thenApply(res -> {
                DataInputStream din = new DataInputStream(new ByteArrayInputStream(res));
                try {
                    String username = Serialize.deserializeString(din, CoreNode.MAX_USERNAME_SIZE);
                    return username;
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            });
        } catch (IOException ioe) {
            LOG.severe("Couldn't connect to " + poster);
            LOG.log(Level.WARNING, ioe.getMessage(), ioe);
            return null;
        }
    }

    @Override
    public CompletableFuture<List<UserPublicKeyLink>> getChain(String username) {
        return getChain("", direct, username);
    }

    @Override
    public CompletableFuture<List<UserPublicKeyLink>> getChain(Multihash targetServerId, String username) {
        return getChain(getProxyUrlPrefix(targetServerId), p2p, username);
    }

    public CompletableFuture<List<UserPublicKeyLink>> getChain(String urlPrefix, HttpPoster poster, String username) {
        try
        {
            ByteArrayOutputStream bout = new ByteArrayOutputStream();
            DataOutputStream dout = new DataOutputStream(bout);

            Serialize.serialize(username, dout);
            dout.flush();

            return poster.postUnzip(urlPrefix + "core/getChain", bout.toByteArray()).thenApply(res -> {
                DataSource din = new DataSource(res);
                try {
                    int count = din.readInt();
                    List<UserPublicKeyLink> result = new ArrayList<>();
                    for (int i = 0; i < count; i++) {
                        result.add(UserPublicKeyLink.fromCbor(CborObject.fromByteArray(Serialize.deserializeByteArray(din, UserPublicKeyLink.MAX_SIZE))));
                    }
                    return result;
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            });
        } catch (IOException ioe) {
            LOG.log(Level.WARNING, ioe.getMessage(), ioe);
            throw new IllegalStateException(ioe);
        }
    }

    @Override
    public CompletableFuture<Boolean> updateChain(String username, List<UserPublicKeyLink> chain) {
        return updateChain("", direct, username, chain);
    }

    @Override
    public CompletableFuture<Boolean> updateChain(Multihash targetServerId, String username, List<UserPublicKeyLink> chain) {
        return updateChain(getProxyUrlPrefix(targetServerId), p2p, username, chain);
    }

    public CompletableFuture<Boolean> updateChain(String urlPrefix, HttpPoster poster, String username, List<UserPublicKeyLink> chain) {
        try
        {
            ByteArrayOutputStream bout = new ByteArrayOutputStream();
            DataOutputStream dout = new DataOutputStream(bout);

            Serialize.serialize(username, dout);
            dout.writeInt(chain.size());
            for (UserPublicKeyLink link : chain) {
                Serialize.serialize(link.serialize(), dout);
            }
            dout.flush();

            return poster.postUnzip(urlPrefix + "core/updateChain", bout.toByteArray()).thenApply(res -> {
                DataInputStream din = new DataInputStream(new ByteArrayInputStream(res));
                try {
                    return din.readBoolean();
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            });
        } catch (IOException ioe) {
            LOG.log(Level.WARNING, ioe.getMessage(), ioe);
            return CompletableFuture.completedFuture(false);
        }
    }

    @Override
    public CompletableFuture<List<String>> getUsernames(String prefix) {
        return getUsernames("", direct, prefix);
    }

    @Override
    public CompletableFuture<List<String>> getUsernames(Multihash targetServerId, String prefix) {
        return getUsernames(getProxyUrlPrefix(targetServerId), p2p, prefix);
    }

    public CompletableFuture<List<String>> getUsernames(String urlPrefix, HttpPoster poster, String prefix) {
        return poster.postUnzip(urlPrefix + "core/getUsernamesGzip/"+prefix, new byte[0])
                .thenApply(raw -> (List) JSONParser.parse(new String(raw)));
    }

    @Override public void close() {}
}
