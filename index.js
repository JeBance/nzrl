const { getHASH,
		hasPGPstructure,
		hasJsonStructure } = require('nzfunc');
const nzmessage = require('nzmessage');
const nznode = require('nznode');

class nzrl {
	CONFIG;
	MESSAGE;
	NODE;

	constructor(CONFIG) {
		this.CONFIG = CONFIG;

		this.MESSAGE = new nzmessage(this.CONFIG);
		this.MESSAGE.autoDel();

		this.NODE = new nznode(this.CONFIG);
		(async () => { this.CONFIG.keyID = await this.NODE.getNodeHash(this.CONFIG) })();
		this.NODE.searchNodesInLocalNetwork();
		this.NODE.checkNodes(this.MESSAGE);
	}

	async requestListener(req, res) {
		let nonce = new Date().getTime();
		res.setHeader('Content-Type', 'application/json');

		if (req.method == 'POST') {

			const buffers = [];
			for await (const chunk of req) {
				buffers.push(chunk);
			}
			const data = Buffer.concat(buffers).toString();
			let hash = await getHASH(data, 'md5');

			// command messages (for interaction between nodes)
			if (hasJsonStructure(data) === true) {
				res.writeHead(200);
				res.end(JSON.stringify({result:'Data successfully received'}));
				req = JSON.parse(data);
				if (this.CONFIG.log) console.log(req);

				// handshake
				if (req.hasOwnProperty('handshake') === true) {
					try {
						let senderHash = await getHASH(JSON.stringify(req.handshake), 'md5');
						if (this.NODE.nodes[senderHash]) throw new Error('The node is already in the list of known nodes.');
						if (req.handshake.net !== this.CONFIG.net) throw new Error('The node does not match the selected network.');
						let senderNodeInfo = await this.NODE.getInfo(req.handshake);
						if (!senderNodeInfo) throw new Error('Failed to get information from node ' + req.handshake.host + ':' + req.handshake.port);
						if (req.handshake.net !== senderNodeInfo.net) throw new Error();
						await this.NODE.add({
							keyID: senderHash,
							net: req.handshake.net,
							prot: req.handshake.prot,
							host: req.handshake.host,
							port: req.handshake.port,
							ping: senderNodeInfo.ping
						});
					} catch(e) {
						if (this.CONFIG.log) console.log(e);
					}

				// newMessage
				} else if (req.hasOwnProperty('newMessage') === true) {
					try {
						if (!(await this.MESSAGE.checkMessageStructure(req.newMessage))
						|| this.MESSAGE.list[req.newMessage.hash] !== undefined) throw new Error();
						let currentTime = new Date().getTime();
						let infoNode = await this.NODE.getInfo({
							prot: req.newMessage.prot,
							host: req.newMessage.host,
							port: req.newMessage.port
						});
						let inequal = currentTime - (infoNode.time + infoNode.ping);
						if (!hasPGPstructure(req.newMessage.message)
						|| (this.MESSAGE.hasExpired(req.newMessage.timestamp))
						|| !((req.newMessage.timestamp + inequal) < currentTime)
						|| (infoNode.net !== this.CONFIG.net)) throw new Error();
						await this.MESSAGE.add(req.newMessage);
						req.newMessage.prot = this.CONFIG.prot;
						req.newMessage.host = this.CONFIG.host;
						req.newMessage.port = this.CONFIG.port;
						await this.NODE.sendMessageToAll({ newMessage: req.newMessage });
					} catch(e) {
						if (this.CONFIG.log) console.log(e);
					}
				}

			// encrypted messages (just save and give)
			} else if (hasPGPstructure(data)) {
				res.writeHead(200);
				try {
					if (this.MESSAGE.list[hash] !== undefined) throw new Error('The message is already in the list of known messages.');
					res.end(JSON.stringify({
						result: 'Data successfully received',
						hash: hash,
						timestamp: nonce
					}));
					let message = {
						prot: this.CONFIG.prot,
						host: this.CONFIG.host,
						port: this.CONFIG.port,
						hash: hash,
						timestamp: nonce,
						message: data
					};
					await this.MESSAGE.add(message);
					await this.NODE.sendMessageToAll({ newMessage: message });
				} catch(e) {
					let message = await this.MESSAGE.getMessage(hash);
					res.end(JSON.stringify({
						result: 'Data successfully received',
						hash: hash,
						timestamp: message.timestamp
					}));
					if (this.CONFIG.log) console.log(e);
				}

			} else {
				res.writeHead(500);
				res.end(JSON.stringify({error:'Invalid request'}));
			}

		} else {

			let url = (req.url).split('?');
			let args = {};
			if (typeof url[1] === 'string') {
				args = url[1].split('&');
			} else {
				args = false;
			}

			switch (url[0]) {
				case '/':
				case '/index.html':
				case '/info':
					let info = JSON.stringify({
						keyID: this.CONFIG.keyID,
						net: this.CONFIG.net,
						prot: this.CONFIG.prot,
						host: this.CONFIG.host,
						port: this.CONFIG.port,
						time: new Date().getTime(),
						autoDel: this.CONFIG.autoDel,
						autoCheckNodes: this.CONFIG.autoCheckNodes,
						autoCheckMessages: this.CONFIG.autoCheckMessages,
						firstMessage: this.MESSAGE.getFirstMessageHash(),
						lastMessage: this.MESSAGE.getLastMessageHash()
					});
					res.writeHead(200);
					res.end(info);
					break
				case '/getNodes':
					res.writeHead(200);
					res.end(JSON.stringify(this.NODE.nodes));
					break
				case '/getMessages':
					res.writeHead(200);
					res.end(JSON.stringify(this.MESSAGE.list));
					break
				case '/getMessage':
					try {
						let message = await this.MESSAGE.getMessage(args[0]);
						if (!message) throw new Error();
						res.writeHead(200);
						res.end(JSON.stringify(message));
					} catch(e) {
						res.writeHead(404);
						res.end(JSON.stringify({error:'Resource not found'}));
					}
					break
				default:
					res.writeHead(404);
					res.end(JSON.stringify({error:'Resource not found'}));
			}

		}

	}

}

module.exports = nzrl;
