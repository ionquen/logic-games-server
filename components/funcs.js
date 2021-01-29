const Crypto = require('crypto')

function randomMath() {
	const random = () => {
		return Math.random().toString(36).substr(2)
	}
	return random()
}
function createToken() {
	const userId = randomMath().match(/^.{4}/)[0]
	const encodedToken = userId + '#' + Date.now().toString()
	const cipher = Crypto.createCipher('aes-256-cbc', "mnfui43hf897fh3847hf7uhvolow87ny874")
	let newToken = cipher.update(encodedToken , 'utf8', 'hex')
	newToken += cipher.final('hex')
	return {token: newToken, userId: userId}
}
function decodeToken(token) {
	const decipher = Crypto.createDecipher('aes-256-cbc', "mnfui43hf897fh3847hf7uhvolow87ny874")
	let deci = decipher.update(token, 'hex', 'utf8')
	deci +=decipher.final('utf8')
	const userId = (deci).match(/^.+(?=\#)/)
	const tokenDateCreated = +(deci).match(/(?=\#).+$/)
	return {userId: userId, date: tokenDateCreated}
}

module.exports = {randomMath, createToken, decodeToken}