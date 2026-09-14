/**
 * @typedef {object} NowPlaying
 * @property {string} id
 * @property {string} name
 * @property {string[]} artists
 * @property {number} runTimeTicks
 * @property {number} positionTicks
 * @property {string} imageUrl
*/

const IS_LOCAL = true;

const jellyfinToken = "";
const jellyfinUser = "";
const jellyfinServer = "";

const ws = IS_LOCAL ? "ws" : "wss";
const http = IS_LOCAL ? "http" : "https"


/**
 * Sets text color to black or white, depending on the average contrasting value of a select area of an image
 */
function updateTextColor() {
	const img = document.getElementById("album_art");

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");

	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;

	ctx.drawImage(img, 0, 0);
	
	const x = Math.floor(canvas.width * 0.4);
	const y = Math.floor(canvas.height * 0.4);
	const width = Math.floor(canvas.width * 0.6);
	const height = Math.floor(canvas.height * 0.2);

	const data = ctx.getImageData(x, y, width, height).data;

	let r = 0;
	let g = 0;
	let b = 0;
	let pixelCount = 0;

	for (let i = 0; i < data.length; i += 4) {
		r += data[i];
		g += data[i + 1];
		b += data[i + 2];
		pixelCount++;
	}

	r /= pixelCount;
	g /= pixelCount;
	b /= pixelCount;
	
	// Complementary color
	r = Math.round(255 - r);
	g = Math.round(255 - g);
	b = Math.round(255 - b);
	
	// Determine whether the complementary color is closer to
	// black or white.
	const distanceToBlack = Math.sqrt(r * r + g * g + b * b);
	const distanceToWhite = Math.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2);
	
	const textColor = distanceToBlack < distanceToWhite ? "#000" : "#fff";

	document.getElementById("song_info").style.setProperty("--text-color", textColor);
}

function updateTextSize(element, maxSize = 32, minSize = 8) {
	let size = maxSize;

	element.style.fontSize = `${size}px`;

	while (element.scrollWidth > element.clientWidth && size > minSize) {
		size--;
		element.style.fontSize = `${size}px`;
	}
}


function getDeviceId(){
	return "1234-5678-1234-5678";
}


class Jellyfin {
	#SERVER_URL;
	#USER_ID;
	#imageCache = new Map();
	#WEBSOCKET;
	#SHOWN_SONG = "0";
	#SHOW_TIMER
	#API_KEY
	
	constructor(SERVER_URL, API_KEY, USER_ID) {
		this.#SERVER_URL = SERVER_URL;
		this.#USER_ID = USER_ID;
		this.#API_KEY = API_KEY;
		
		const uuid = getDeviceId();
		this.#WEBSOCKET = new WebSocket(`${ws}://${this.#SERVER_URL}/socket?api_key=${encodeURIComponent(this.#API_KEY)}&deviceId=${encodeURIComponent(uuid)}`);
			
		this.#WEBSOCKET.onopen = () => this.#onOpen();
		this.#WEBSOCKET.onmessage = (message) => this.#onMessage(message);
		this.#WEBSOCKET.onclose = (event) => this.#onClose(event);
		this.#WEBSOCKET.onerror = (error) => this.#onError(error);
	}
	
	
	// Show if true, hide if false
	#showHidePlayer(bool){
		const player = document.getElementById("music-player");
		player.style.transform = bool ? "translateY(5px)" : "translateY(200px)";
	}
	
	/**
	 * @memberof Jellyfin
	 * @param {NowPlaying} nowPlaying
	 */
	#updatePlayer(nowPlaying){
		if(this.#SHOWN_SONG === nowPlaying.id) return; // Same song isn't going to change anything
		
		const playerBG = document.getElementById("player-bg");
		const albumArt = document.getElementById("album_art");
		const songName = document.getElementById("song_name");
		const artistName = document.getElementById("artist_name");
		
		albumArt.src = nowPlaying.imageUrl;
		playerBG.style.backgroundImage = `url(${nowPlaying.imageUrl})`
		
		songName.innerText = nowPlaying.name;
		updateTextSize(songName, 32, 8);
		
		let artists = nowPlaying.artists.length > 1 ? nowPlaying.artists.slice(0, -1).join(", ") + " & " + nowPlaying.artists.at(-1) : nowPlaying.artists[0];
		if(!artists) artists = "unknown";
		artistName.innerText = `by ${artists}`;
		updateTextSize(artistName, 20, 8);
		
		if(this.#SHOWN_SONG !== nowPlaying.id){
			if(this.#SHOW_TIMER) clearTimeout(this.#SHOW_TIMER);
			
			this.#showHidePlayer(true);
			this.#SHOWN_SONG = nowPlaying.id;
			this.#SHOW_TIMER = setTimeout(this.#showHidePlayer.bind(null, false), 15000);
		}
	}
	
	async #onMessage(message){
		const json = JSON.parse(message.data);
		if(json.MessageType !== "Sessions") return;
			

		const session = json.Data.find(sesh =>
			sesh.UserId === this.#USER_ID &&
			sesh.NowPlayingItem?.Type === "Audio" &&
			!sesh.PlayState?.IsPaused
		);
		
		/** @type {string} songName */
		let songName = session.NowPlayingItem.Name;
		if(songName.length > 25) songName = songName.slice(0, 20).trim() + "...";
		
		if(!session) return this.#showHidePlayer(false);
		
		const artists = session.NowPlayingItem.Artists || ["Unknown Artist"];
		const image = await this.#getItemImageUrl(session.NowPlayingItem.Id, session.NowPlayingItem.AlbumId);
		
		const nowPlaying = {
			id: session.NowPlayingItem.Id,
			name: songName,
			artists: artists,
			runTimeTicks: session.NowPlayingItem.RunTimeTicks,
			positionTicks: session.PlayState.PositionTicks,
			imageUrl: image
		};
		
		return this.#updatePlayer(nowPlaying)
	}

	// Returns the "primary" image for a given item ID. If the image is not found, it returns "unknown_image"
	// Also caches the image URL for future requests
	async #getItemImageUrl(itemId, albumId) {
		if(this.#imageCache.has(itemId)) return this.#imageCache.get(itemId);
		
		let imageURL = "./unknown.png";
		this.#imageCache.set(itemId, imageURL);
		
		try {
			const itemImageURL = `${http}://${this.#SERVER_URL}/Items/${itemId}/Images/Primary?maxWidth=100&maxHeight=100`;
			const itemRes = await fetch(itemImageURL, { method: "HEAD" });
			
			const albumImageURL = `${http}://${this.#SERVER_URL}/Items/${albumId}/Images/Primary?maxWidth=100&maxHeight=100`;
			const albumRes = await fetch(albumImageURL, { method: "HEAD" });
			
			imageURL = itemRes.ok ? itemImageURL : (albumRes.ok ? albumImageURL : imageURL);
			this.#imageCache.set(itemId, imageURL);
		} catch {
			null;
		}
		
		return this.#imageCache.get(itemId);
	}
	
	#onOpen(){
		console.log("CONNECTED")
			
		this.#WEBSOCKET.send(JSON.stringify({
			MessageType: "SessionsStart",
			Data: "0,3000" // Every 3 seconds
		}));
	}
	
	#onClose(event){
		console.warn("Socket Closed:", event)
		this.#WEBSOCKET = null;
		
		setTimeout(() => { // Reconnect after 5 seconds
			const uuid = getDeviceId();
			this.#WEBSOCKET = new WebSocket(`${ws}://${this.#SERVER_URL}/socket?api_key=${encodeURIComponent(this.#API_KEY)}&deviceId=${encodeURIComponent(uuid)}`);
			this.#WEBSOCKET.onopen = () => this.#onOpen();
			this.#WEBSOCKET.onmessage = (message) => this.#onMessage(message);
			this.#WEBSOCKET.onclose = (event) => this.#onClose(event);
			this.#WEBSOCKET.onerror = (error) => this.#onError(error);
		}, 5000)
	}
	
	#onError(error){
		console.error("Websocket Error:", error)
	}
}


const albumArt = document.getElementById("album_art");
albumArt.crossOrigin = "anonymous";
albumArt.addEventListener("load", updateTextColor);

new Jellyfin(jellyfinServer, jellyfinToken, jellyfinUser);