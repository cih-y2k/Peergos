package peergos.shared.mutable;

import peergos.shared.corenode.*;
import peergos.shared.crypto.hash.*;
import peergos.shared.io.ipfs.multihash.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

public class ProxyingMutablePointers implements MutablePointers {

    private final Multihash serverId;
    private final CoreNode core;
    private final MutablePointersProxy mutable;

    public ProxyingMutablePointers(Multihash serverId, CoreNode core, MutablePointersProxy mutable) {
        this.serverId = serverId;
        this.core = core;
        this.mutable = mutable;
    }

    @Override
    public CompletableFuture<Boolean> setPointer(PublicKeyHash owner, PublicKeyHash writer, byte[] writerSignedBtreeRootHash) {
        return redirectCall(writer,
                () -> mutable.setPointer(owner, writer, writerSignedBtreeRootHash),
                target -> mutable.setPointer(target, owner, writer, writerSignedBtreeRootHash));
    }

    @Override
    public CompletableFuture<Optional<byte[]>> getPointer(PublicKeyHash owner, PublicKeyHash writer) {
        return redirectCall(owner,
                () -> mutable.getPointer(owner, writer),
                target -> mutable.getPointer(target, owner, writer));
    }

    public <V> CompletableFuture<V> redirectCall(PublicKeyHash ownerKey, Supplier<CompletableFuture<V>> direct, Function<Multihash, CompletableFuture<V>> proxied) {
        return core.getUsername(ownerKey)
                .thenCompose(owner -> core.getChain(owner)
                        .thenCompose(chain -> {
                            if (chain.isEmpty()) {
                                // This happens during sign-up, before we have a chain yet
                                return direct.get();
                            }
                            List<Multihash> storageIds = chain.get(chain.size() - 1).claim.storageProviders;
                            Multihash target = storageIds.get(0);
                            if (target.equals(serverId)) { // don't proxy
                                return direct.get();
                            } else {
                                return proxied.apply(target);
                            }
                        }));

    }
}
