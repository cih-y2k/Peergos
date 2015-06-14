if (typeof module !== "undefined")
    var nacl = require("./nacl");

// API for the User interface to use
/////////////////////////////

/////////////////////////////
// UserPublicKey methods
function UserPublicKey(publicSignKey, publicBoxKey) {
    this.pSignKey = publicSignKey; // 32 bytes
    this.pBoxKey = publicBoxKey; // 32 bytes

    // ((err, publicKeyString) -> ())
    this.getPublicKeys = function() {
	var tmp = new Uint8Array(this.pSignKey.length + this.pBoxKey.length);
	tmp.set(this.pSignKey, 0);
	tmp.set(this.pBoxKey, this.pSignKey.length);
	return tmp;
    }
    
    // (Uint8Array, User, (nonce, cipher) -> ())
    this.encryptMessageFor = function(input, us) {
	var nonce = createNonce();
	return concat(nacl.box(input, nonce, this.pBoxKey, us.sBoxKey), nonce);
    }
    
    // Uint8Array => boolean
    this.unsignMessage = function(sig) {
	return nacl.sign.open(sig, this.pSignKey);
    }
    
    this.isValidSignature = function(signedHash, raw) {
	var a = hash(raw);
	var b = unsignMessage(signedHash);
	return arraysEqual(a, b);
    }

    // Uint8Array => Uint8Array
    this.hash = function(input) {
	var hasher = new BLAKE2s(32);
	hasher.update(input);
	return hasher.digest();
    }
}

UserPublicKey.fromPublicKeys = function(both) {
    var pSign = slice(both, 0, 32);
    var pBox = slice(both, 32, 64);
    return new UserPublicKey(pSign, pBox);
}

function createNonce(){
    return window.nacl.randomBytes(24);
}

/////////////////////////////
// User methods
// (string, string, (User -> ())
function generateKeyPairs(username, password, cb) {
    var hash = new BLAKE2s(32)
    hash.update(nacl.util.decodeUTF8(password))
    salt = nacl.util.decodeUTF8(username)
    scrypt(hash.digest(), salt, 17, 8, 64, 1000, function(keyBytes) {
	var bothBytes = nacl.util.decodeBase64(keyBytes);
	var signBytes = bothBytes.subarray(0, 32);
	var boxBytes = bothBytes.subarray(32, 64);
	return cb(new User(nacl.sign.keyPair.fromSeed(signBytes), nacl.box.keyPair.fromSecretKey(new Uint8Array(boxBytes))));
    }, 'base64');
}

function User(signKeyPair, boxKeyPair) {
    UserPublicKey.call(this, signKeyPair.publicKey, boxKeyPair.publicKey);
    this.sSignKey = signKeyPair.secretKey; // 64 bytes
    this.sBoxKey = boxKeyPair.secretKey; // 32 bytes
    
    // (Uint8Array, (nonce, sig) => ())
    this.hashAndSignMessage = function(input, cb) {
	signMessage(this.hash(input), cb);
    }
    
    // (Uint8Array, (nonce, sig) => ())
    this.signMessage = function(input) {
	return nacl.sign(input, this.sSignKey);
    }
    
    // (Uint8Array, (err, literals) -> ())
    this.decryptMessage = function(cipher, them) {
	var nonce = slice(cipher, cipher.length-24, cipher.length);
	cipher = slice(cipher, 0, cipher.length-24);
	return nacl.box.open(cipher, nonce, them.pBoxKey, this.sBoxKey);
    }

    this.getSecretKeys = function() {
	var tmp = new Uint8Array(this.sSignKey.length + this.sBoxKey.length);
	tmp.set(this.sSignKey, 0);
	tmp.set(this.sBoxKey, this.sSignKey.length);
	return tmp;
    }
}

User.fromEncodedKeys = function(publicKeys, secretKeys) {
    return new User(toKeyPair(slice(publicKeys, 0, 32), slice(secretKeys, 0, 64)), toKeyPair(slice(publicKeys, 32, 64), slice(secretKeys, 64, 96)));
}

User.fromSecretKeys = function(secretKeys) {
    var publicBoxKey = new Uint8Array(32);
    nacl.lowlevel.crypto_scalarmult_base(publicBoxKey, slice(secretKeys, 64, 96))
    return User.fromEncodedKeys(concat(slice(secretKeys, 32, 64), 
				publicBoxKey), 
				secretKeys);
}

User.random = function() {
    var secretKeys = window.nacl.randomBytes(96);
    return User.fromSecretKeys(secretKeys);
}

function toKeyPair(pub, sec) {
    return {publicKey:pub, secretKey:sec};
}

/////////////////////////////
// SymmetricKey methods

// () => Uint8Array
function randomIV() {
    return nacl.randomBytes(24);
}

function SymmetricKey(key) {
    this.key = key;

    // (Uint8Array, Uint8Array[24]) => Uint8Array
    this.encrypt = function(data, nonce) {
	return nacl.secretbox(data, nonce, this.key);
    }

    // (Uint8Array, Uint8Array) => Uint8Array
    this.decrypt = function(cipher, nonce) {
	return nacl.secretbox.open(cipher, nonce, this.key);
    }
}
SymmetricKey.NONCE_BYTES = 24;
SymmetricKey.random = function() {
    return new SymmetricKey(nacl.randomBytes(32));
}

/////////////////////////////
// Util methods

// byte[] input and return
function encryptBytesToBytes(input, pubKey) {
    return Java.to(encryptUint8ToUint8(input, pubKey), "byte[]");
}

// byte[] cipher and return
function decryptBytesToBytes(cipher, privKey) {
    return Java.to(decryptUint8ToUint8(cipher, privKey), "byte[]");
}

function uint8ArrayToByteArray(arr) {
    return Java.to(arr, "byte[]");
}

function slice(arr, start, end) {
    var r = new Uint8Array(end-start);
    if (arr instanceof ByteBuffer) {
	for (var i=start; i < end; i++)
	    r[i-start] = arr.raw[i];
    } else {
	for (var i=start; i < end; i++)
	    r[i-start] = arr[i];
    }
    return r;
}

function concat(a, b, c) {
    var r = new Uint8Array(a.length+b.length+(c != null ? c.length : 0));
    for (var i=0; i < a.length; i++)
	r[i] = a[i];
    for (var i=0; i < b.length; i++)
	r[a.length+i] = b[i];
    if (c != null)
	for (var i=0; i < c.length; i++)
	    r[a.length+b.length+i] = c[i];
    return r;
}

function get(path, onSuccess, onError) {

    var request = new XMLHttpRequest();
    request.open("GET", path);

    request.onreadystatechange=function()
    {
        if (request.readyState != 4)
            return;

        if (request.status == 200) 
            onSuccess(request.response);
        else
            onError(request.status);
    }

    request.send();
}

function post(path, data, onSuccess, onError) {

    var request = new XMLHttpRequest();
    request.open("POST" , path);
    request.responseType = 'arraybuffer';

    request.onreadystatechange=function()
    {
        if (request.readyState != 4)
            return;

        if (request.status == 200) 
            onSuccess(request.response);
        else
            onError(request.status);
    }

    request.send(data);
}

//Java is Big-endian
function readInt(bytes, position) {
    var count = 0;
    for(var i = position; i <  position +4 ; i++)
        count = count << 8 + bytes[i];
    return count;
}

//Java is Big-endian
function writeInt(bytes, position, intValue) {
    intValue |= 0;
    for(var i = position + 3; position <= i ; i--)
        bytes[position] = intValue & 0xff;
        intValue >>= 8;
}

function arraysEqual(leftArray, rightArray) {
    if (leftArray.length != rightArray.length)
        return false;
    
    for (var i=0; i < leftArray.length; i++) 
        if (leftArray[i] != rightArray[i])
            return false;
    
    return true;
}

function DHTClient() {
    //
    //put
    //
    this.put = function(keyData, valueData, username, sharingKeyData, mapKeyData, proofData, onSuccess, onError) {
        var arrays = [keyData, valueData, username, sharingKeyData, mapKeyData, proofData];
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        for (var iArray=0; iArray < arrays.length; iArray++) 
            buffer.writeArray(arrays[iArray]);
        post("dht/put", buffer, onSuccess, onError);
    };
    //
    //get
    //
    this.get = function(keyData, onSuccess, onError) { 
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(keyData);
        post("dht/get", buffer, onSuccess, onError); 
    };
    
    //
    //contains
    //
    this.contains = function(keyData, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(keyData);
        post("dht/contains", buffer, onSuccess, onError); 
    };
}

function CoreNodeClient() {
    //String -> fn- >fn -> void
    this.getPublicKey = function(username, onSuccess, onError) {
        var buffer = new  ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
	buffer.writeUnsignedInt(username.length);
        buffer.writeString(username);
        post("core/getPublicKey", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String -> Uint8Array -> Uint8Array -> fn -> fn -> void
    this.updateStaticData = function(username, signedHash, staticData, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
	buffer.writeUnsignedInt(username.length);
        buffer.writeString(username);
        buffer.writeArray(signedHash);
        buffer.writeArray(staticData);
        post("core/updateStaticData", new Uint8Array(buffer.toArray()), onSuccess, onError); 
    };
    
    //String -> fn- >fn -> void
    this.getStaticData = function(username, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        post("core/getStaticData", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //Uint8Array -> fn -> fn -> void
    this.getUsername = function(publicKey, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(publicKey);
        post("core/getUsername", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    
    //String -> Uint8Array -> Uint8Array -> fn -> fn -> void
    this.addUsername = function(username, encodedUserKey, signed, staticData, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
	buffer.writeUnsignedInt(username.length);
        buffer.writeString(username);
        buffer.writeArray(encodedUserKey);
        buffer.writeArray(signed);
        buffer.writeArray(staticData);
        post("core/addUsername", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //Uint8Array -> Uint8Array -> fn -> fn -> void
    this.followRequest = function( target,  encryptedPermission, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(target);
        buffer.writeArray(encryptedPermission);
        post("core/followRequest", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String -> Uint8Array -> fn -> fn -> void
    this.getFollowRequests = function( user, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(user);
        post("core/getFollowRequests", new Uint8Array(buffer.toArray()), 
	     function(res) {
		 var buf = new ByteBuffer(res);
		 var size = buf.readUnsignedInt();
		 var n = buf.readUnsignedInt();
		 var arr = [];
		 for (var i=0; i < n; i++) {
		     var t = buf.readArray();
		     arr.push(new Uint8Array(t.toArray()));
		 }
		 onSuccess(arr);}, onError);
    };
    
    //String -> Uint8Array -> Uint8Array -> fn -> fn -> void
    this.removeFollowRequest = function( target,  data,  signed, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(target);
        buffer.writeArray(data);
        buffer.writeArray(signed);
        post("core/removeFollowRequest", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };

    //String -> Uint8Array -> Uint8Array -> fn -> fn -> void
    this.allowSharingKey = function(owner, signedWriter, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(owner);
        buffer.writeArray(signedWriter); 
        post("core/allowSharingKey", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String -> Uint8Array -> Uint8Array -> fn -> fn -> void
    this.banSharingKey = function( username,  encodedSharingPublicKey,  signedHash, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        buffer.writeArray(encodedSharingPublicKey);
        buffer.writeArray(signedHash); 
        post("core/banSharingKey", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };

    //String -> Uint8Array -> Uint8Array -> Uint8Array  -> Uint8Array -> fn -> fn -> void
    this.addMetadataBlob = function( username,  encodedSharingPublicKey,  mapKey,  metadataBlob,  sharingKeySignedHash, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        buffer.writeArray(encodedSharingPublicKey);
        buffer.writeArray(mapKey);
        buffer.writeArray(metadataBlob);
        buffer.writeArray(sharingKeySignedHash);
        post("core/addMetadataBlob", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String -> Uint8Array -> Uint8Array  -> Uint8Array -> fn -> fn -> void
    this.removeMetadataBlob = function( username,  encodedSharingKey,  mapKey,  sharingKeySignedMapKey, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        buffer.writeArray(encodedSharingKey);
        buffer.writeArray(mapKey);
        buffer.writeArray(sharingKeySignedMapKey);
        post("core/removeMetadataBlob", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };

    //String  -> Uint8Array  -> Uint8Array -> fn -> fn -> void
    this.removeUsername = function( username,  userKey,  signedHash, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        buffer.writeArray(userKey);
        buffer.writeArray(signedHash);
        post("core/removeUsername", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };

    //String -> fn -> fn -> void
    this.getSharingKeys = function( username, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        post("core/getSharingKeys", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String  -> Uint8Array  -> fn -> fn -> void
    this.getMetadataBlob = function( username,  encodedSharingKey,  mapKey, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        buffer.writeArray(encodedSharingKey);
        buffer.writeArray(mapKey);
        post("core/getMetadataBlob", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String  -> Uint8Array  -> Uint8Array -> fn -> fn -> void
    this.isFragmentAllowed = function( owner,  encodedSharingKey,  mapkey,  hash, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(owner);
        buffer.writeArray(encodedSharingKey);
        buffer.writeArray(mapKey);
        buffer.writeArray(hash);
        post("core/isFragmentAllowed", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String -> fn -> fn -> void
    this.getQuota = function(user, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(user.getPublicKeys());
        post("core/getQuota", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String -> fn -> fn -> void
    this.getUsage = function(username, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        post("core/getUsage", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
    
    //String  -> Uint8Array  -> Uint8Array -> fn -> fn -> void
    this.getFragmentHashes = function( username, sharingKey, mapKey, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        buffer.writeArray(sharingKey);
        buffer.writeArray(mapKey);
        post("core/getFragmentHashes", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };

    //String  -> Uint8Array  -> Uint8Array -> Uint8Array -> [Uint8Array] -> Uint8Array -> fn -> fn -> void
    this.addFragmentHashes = function(username, encodedSharingPublicKey, mapKey, metadataBlob, allHashes, sharingKeySignedHash) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeString(username);
        buffer.writeArray(encodedShaaringPublicKey);
        buffer.writeArray(mapKey);
        buffer.writeArray(metadataBlob);
	
        buffer.writeInt(allHashes.length);
        for (var iHash=0; iHash  <  allHashes.length; iHash++) 
            buffer.writeArray(allHashes[iHash]);
	
        buffer.writeArray(sharingKeySignedHash);
        
        post("core/addFragmentHashes", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };

    
    this.registerFragmentStorage = function(spaceDonor, address, port, owner, signedKeyPlusHash, onSuccess, onError) {
        var buffer = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buffer.writeArray(spaceDonor.getPublicKeys());
        buffer.writeArray(address);
	buffer.writeInt(port);
        buffer.writeArray(owner.getPublicKeys());
        buffer.writeArray(signedKeyPlusHash);
        post("core/registerFragmentStorage", new Uint8Array(buffer.toArray()), onSuccess, onError);
    };
};

function UserContext(username, user, dhtClient,  corenodeClient) {
    this.username  = username;
    this.user = user;
    this.dhtClient = dhtClient;
    this.corenodeClient = corenodeClient;
    this.staticData = []; // array of map entry pairs

    this.isRegistered = function(cb) {
	corenodeClient.getUsername(user.getPublicKeys(), function(res){
            cb(username == res);
	});
    }

    this.serializeStatic = function() {
        var buf = new ByteBuffer(0, ByteBuffer.BIG_ENDIAN, true);
        buf.writeUnsignedInt(this.staticData.length);
        for (var i = 0; i < this.staticData.length; i++)
            buf.writeArray(this.staticData[i][1].serialize());
        return buf.toArray();
    }

    this.register = function(onSuccess, onError) {
	console.log("registering "+username);
	var rawStatic = this.serializeStatic();
        var signed = user.signMessage(concat(nacl.util.decodeUTF8(username), user.getPublicKeys(), rawStatic));
        return corenodeClient.addUsername(username, user.getPublicKeys(), signed, rawStatic, onSuccess, onError)
    }

    this.sendFollowRequest = function(targetUser, onSuccess, onError) {
	// create sharing keypair and give it write access
        var sharing = User.random();
	var that = this;
        this.addSharingKey(sharing,  function() {
            var rootMapKey = new ByteBuffer(window.nacl.randomBytes(32));
	    
            // add a note to our static data so we know who we sent the private key to
            var friendRoot = new WritableFilePointer(user, sharing, rootMapKey, SymmetricKey.random());
            that.addToStaticData(sharing, friendRoot, function() {
	    
		// send details to allow friend to share with us (i.e. we follow them)
		var raw = friendRoot.serialize();
		
		// create a tmp keypair whose public key we can append to the request without leaking information
		var tmp = User.random();
		var payload = targetUser.encryptMessageFor(new Uint8Array(raw), tmp);
		corenodeClient.followRequest(targetUser.getPublicKeys(), concat(tmp.pBoxKey, payload), onSuccess, onError);
	    });
	}, onError);
    }

    this.addSharingKey = function(pub, onSuccess) {
	var signed = user.signMessage(pub.getPublicKeys());
        corenodeClient.allowSharingKey(user.getPublicKeys(), signed, onSuccess);
    }

    this.addToStaticData = function(writer, root, onSuccess) {
	this.staticData.push([writer, root]);
        var rawStatic = new Uint8Array(this.serializeStatic());
        corenodeClient.updateStaticData(username, user.signMessage(rawStatic), rawStatic, onSuccess);
    }

    this.getFollowRequests = function(onSuccess, onError) {
	corenodeClient.getFollowRequests(user.getPublicKeys(), onSuccess, onError);
    }

    this.decodeFollowRequest = function(raw) {
	var pBoxKey = new Uint8Array(32);
	for (var i=0; i < 32; i++)
            pBoxKey[i] = raw[i]; // signing key is not used
        var tmp = new UserPublicKey(null, pBoxKey);
	var buf = new ByteBuffer(raw);
	buf.read(32);
	var cipher = buf.read(raw.length - 32);
        var decrypted = user.decryptMessage(cipher.toArray(), tmp);
        return WritableFilePointer.deserialize(new Uint8Array(decrypted)); // somehow not creating a new uint8array keeps the extra 32 bytes...
    }

    this.downloadFragments = function(hashes) {
        var result = {}; 
        result.fragments = [];
        result.nSuccess = 0;
        result.nError = 0;
        
        var completion  = function() {
            if (this.nSuccess + this.nError < this.fragments.length)
                return;
            console.log("Completed");
            if (this.nError  > 0)
                throw "found "+ nError +" errors.";
            return this.fragments; 
        }.bind(result);

        var success = function(fragmentData, index) {
            this.fragments.index = fragmentData;
            this.nSuccess += 1;         
            completion();
        }.bind(result);

        var error = function(index) {
            this.nError +=1;
            completion(fragments);
        }.bind(result);


        for (var iHash=0; iHash < hashes.length; iHash++) {
            var hash = hashes[iHash];
            var onSuccess = onSuccess()  
            dhtClient.get(hash) 
        }
    }

    this.getMetadata = function(location) {

    }
}

if (typeof module !== "undefined"){
    module.exports.randomSymmetricKey = randomSymmetricKey;
    module.exports.SymmetricKey = SymmetricKey;
}
 
