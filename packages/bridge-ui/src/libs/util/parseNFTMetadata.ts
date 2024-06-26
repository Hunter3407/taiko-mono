import axios, { AxiosError, type AxiosResponse } from 'axios';

import { apiService } from '$config';
import { type NFT, type NFTMetadata, TokenType } from '$libs/token';
import { safeParseUrl } from '$libs/util/safeParseUrl';

import { checkForAdblocker } from './checkForAdblock';
import { extractIPFSCidFromUrl } from './extractIPFSCidFromUrl';
import { getLogger } from './logger';

const log = getLogger('libs:token:parseNFTMetadata');

const request = axios.create({ timeout: apiService.timeout });

export const parseNFTMetadata = async (token: NFT): Promise<NFTMetadata | null> => {
  if (token.type !== TokenType.ERC721 && token.type !== TokenType.ERC1155) throw new Error('Not a NFT');

  log(`fetching metadata for ${token.name} id: ${token.tokenId}`);

  if (!token.uri) throw new Error('No token URI found');

  if (token.uri.includes('{id}')) {
    token.uri = token.uri.replace('{id}', token.tokenId.toString());
  }

  const url = safeParseUrl(token.uri);
  if (!url) throw new Error(`Invalid token URI: ${token.uri}`);

  let json;

  try {
    json = await request.get(url);
  } catch (err) {
    const error = err as AxiosError;
    log(`error fetching metadata for ${token.name} id: ${token.tokenId}`, error);
    //todo: handle different error scenarios?
    json = await retry(url, token.tokenId);
  }
  if (!json) {
    const isBlocked = await checkForAdblocker(url);
    if (isBlocked) {
      log(`The resource at ${url} is blocked by an adblocker`);
      json = await retry(url, token.tokenId);
    } else {
      throw new Error(`No metadata found for ${token.name} id: ${token.tokenId}`);
    }
  }

  if (!json || json instanceof Error) {
    // Handle error
    throw new Error(`No metadata found for ${token.name} id: ${token.tokenId}`);
  }
  const metadata = {
    description: json.data.description || '',
    external_url: json.data.external_url || '',
    image: json.data.image || '',
    name: json.data.name || '',
  };

  log(`fetched metadata for ${token.name} id: ${token.tokenId}`, metadata);
  return metadata;
};

// TODO: we could retry several times with different gateways
const retry = async (url: string, tokenId: number): Promise<AxiosResponse | Error> => {
  let newUrl;
  tokenId !== undefined && tokenId !== null ? (newUrl = useGateway(url, tokenId)) : (newUrl = useGateway(url, tokenId));
  if (newUrl) {
    const result = await retryRequest(newUrl);
    if (result instanceof Error) {
      return result;
    }
    return result;
  }
  return new Error(`No metadata found for ${url}`);
};

const retryRequest = async (newUrl: string): Promise<AxiosResponse | Error> => {
  try {
    log(`retrying with ${newUrl}`);
    return await request.get(newUrl);
  } catch (error) {
    log('retrying failed', error);
    throw new Error(`No metadata found for ${newUrl}`);
  }
};

//TODO: make this configurable via the config system?
const useGateway = (url: string, tokenId: number) => {
  const { cid } = extractIPFSCidFromUrl(url);
  let gateway: string;
  if (tokenId !== undefined && tokenId !== null && cid) {
    gateway = `https://ipfs.io/ipfs/${cid}/${tokenId}.json`;
  } else {
    log(`no valid CID found in ${url}`);
    return null;
  }
  return gateway;
};
