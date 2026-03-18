import { data } from "react-router";

export function jsonOk<T>(body: T, headers?: Headers) {
  return data(body, { status: 200, headers });
}

export function jsonCreated<T>(body: T, headers?: Headers) {
  return data(body, { status: 201, headers });
}

export function jsonBadRequest<T>(body: T, headers?: Headers) {
  return data(body, { status: 400, headers });
}

export function jsonUnauthorized<T>(body: T, headers?: Headers) {
  return data(body, { status: 401, headers });
}

export function jsonForbidden<T>(body: T, headers?: Headers) {
  return data(body, { status: 403, headers });
}

export function jsonNotFound<T>(body: T, headers?: Headers) {
  return data(body, { status: 404, headers });
}

export function jsonServerError<T>(body: T, headers?: Headers) {
  return data(body, { status: 500, headers });
}
