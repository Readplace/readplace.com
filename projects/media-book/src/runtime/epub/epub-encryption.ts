import { elementsNamed, parseXml } from "./xml-elements";
import { readZipEntry } from "./zip-entries";

const FONT_OBFUSCATION_ALGORITHMS = new Set([
	"http://www.idpf.org/2008/embedding",
	"http://ns.adobe.com/pdf/enc#RC",
]);

export function isDrmProtected(bytes: Uint8Array): boolean {
	const encryptionXml = readZipEntry({ bytes, name: "META-INF/encryption.xml" });
	if (encryptionXml === undefined) return false;
	const document = parseXml(encryptionXml);
	return elementsNamed({ within: document, name: "encrypteddata" }).some((encrypted) => {
		const algorithms = elementsNamed({ within: encrypted, name: "encryptionmethod" }).map((method) => method.getAttribute("Algorithm"));
		return !algorithms.every((algorithm) => algorithm !== null && FONT_OBFUSCATION_ALGORITHMS.has(algorithm));
	});
}
