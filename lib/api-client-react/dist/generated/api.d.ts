import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { AdminDashboard, ApproveStudentBody, AuthResponse, Class, CreateAdminBody, CreateClassBody, CreateSupportTicketBody, ErrorResponse, FeedbackItem, HealthStatus, ListClassesParams, ListSupportTicketsParams, ListUsersParams, LoginBody, RegisterStudentBody, RespondToTicketBody, SaveWhiteboardBody, StudentDashboard, SubmitFeedbackBody, SuccessResponse, SuperAdminDashboard, SupportTicket, UpdateClassBody, UpdateUserBody, User, WhiteboardData } from "./api.schemas";
import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
/**
 * Returns server health status
 * @summary Health check
 */
export declare const getHealthCheckUrl: () => string;
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Login
 */
export declare const getLoginUrl: () => string;
export declare const login: (loginBody: LoginBody, options?: RequestInit) => Promise<AuthResponse>;
export declare const getLoginMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginBody>;
}, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<LoginBody>;
export type LoginMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Login
 */
export declare const useLogin: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginBody>;
}, TContext>;
/**
 * @summary Register a new student
 */
export declare const getRegisterStudentUrl: () => string;
export declare const registerStudent: (registerStudentBody: RegisterStudentBody, options?: RequestInit) => Promise<User>;
export declare const getRegisterStudentMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerStudent>>, TError, {
        data: BodyType<RegisterStudentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof registerStudent>>, TError, {
    data: BodyType<RegisterStudentBody>;
}, TContext>;
export type RegisterStudentMutationResult = NonNullable<Awaited<ReturnType<typeof registerStudent>>>;
export type RegisterStudentMutationBody = BodyType<RegisterStudentBody>;
export type RegisterStudentMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Register a new student
 */
export declare const useRegisterStudent: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof registerStudent>>, TError, {
        data: BodyType<RegisterStudentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof registerStudent>>, TError, {
    data: BodyType<RegisterStudentBody>;
}, TContext>;
/**
 * @summary Logout
 */
export declare const getLogoutUrl: () => string;
export declare const logout: (options?: RequestInit) => Promise<SuccessResponse>;
export declare const getLogoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export type LogoutMutationResult = NonNullable<Awaited<ReturnType<typeof logout>>>;
export type LogoutMutationError = ErrorType<unknown>;
/**
 * @summary Logout
 */
export declare const useLogout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
/**
 * @summary Get current logged in user
 */
export declare const getGetCurrentUserUrl: () => string;
export declare const getCurrentUser: (options?: RequestInit) => Promise<User>;
export declare const getGetCurrentUserQueryKey: () => readonly ["/api/auth/me"];
export declare const getGetCurrentUserQueryOptions: <TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetCurrentUserQueryResult = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
export type GetCurrentUserQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get current logged in user
 */
export declare function useGetCurrentUser<TData = Awaited<ReturnType<typeof getCurrentUser>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getCurrentUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List all users (super admin / admin)
 */
export declare const getListUsersUrl: (params?: ListUsersParams) => string;
export declare const listUsers: (params?: ListUsersParams, options?: RequestInit) => Promise<User[]>;
export declare const getListUsersQueryKey: (params?: ListUsersParams) => readonly ["/api/users", ...ListUsersParams[]];
export declare const getListUsersQueryOptions: <TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(params?: ListUsersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListUsersQueryResult = NonNullable<Awaited<ReturnType<typeof listUsers>>>;
export type ListUsersQueryError = ErrorType<unknown>;
/**
 * @summary List all users (super admin / admin)
 */
export declare function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(params?: ListUsersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create admin user (super admin only)
 */
export declare const getCreateAdminUrl: () => string;
export declare const createAdmin: (createAdminBody: CreateAdminBody, options?: RequestInit) => Promise<User>;
export declare const getCreateAdminMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdmin>>, TError, {
        data: BodyType<CreateAdminBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAdmin>>, TError, {
    data: BodyType<CreateAdminBody>;
}, TContext>;
export type CreateAdminMutationResult = NonNullable<Awaited<ReturnType<typeof createAdmin>>>;
export type CreateAdminMutationBody = BodyType<CreateAdminBody>;
export type CreateAdminMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Create admin user (super admin only)
 */
export declare const useCreateAdmin: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdmin>>, TError, {
        data: BodyType<CreateAdminBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAdmin>>, TError, {
    data: BodyType<CreateAdminBody>;
}, TContext>;
/**
 * @summary Get user by ID
 */
export declare const getGetUserUrl: (id: number) => string;
export declare const getUser: (id: number, options?: RequestInit) => Promise<User>;
export declare const getGetUserQueryKey: (id: number) => readonly [`/api/users/${number}`];
export declare const getGetUserQueryOptions: <TData = Awaited<ReturnType<typeof getUser>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUser>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUserQueryResult = NonNullable<Awaited<ReturnType<typeof getUser>>>;
export type GetUserQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get user by ID
 */
export declare function useGetUser<TData = Awaited<ReturnType<typeof getUser>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUser>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update user
 */
export declare const getUpdateUserUrl: (id: number) => string;
export declare const updateUser: (id: number, updateUserBody: UpdateUserBody, options?: RequestInit) => Promise<User>;
export declare const getUpdateUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
        id: number;
        data: BodyType<UpdateUserBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
    id: number;
    data: BodyType<UpdateUserBody>;
}, TContext>;
export type UpdateUserMutationResult = NonNullable<Awaited<ReturnType<typeof updateUser>>>;
export type UpdateUserMutationBody = BodyType<UpdateUserBody>;
export type UpdateUserMutationError = ErrorType<unknown>;
/**
 * @summary Update user
 */
export declare const useUpdateUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
        id: number;
        data: BodyType<UpdateUserBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateUser>>, TError, {
    id: number;
    data: BodyType<UpdateUserBody>;
}, TContext>;
/**
 * @summary Delete user (super admin only)
 */
export declare const getDeleteUserUrl: (id: number) => string;
export declare const deleteUser: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
    id: number;
}, TContext>;
export type DeleteUserMutationResult = NonNullable<Awaited<ReturnType<typeof deleteUser>>>;
export type DeleteUserMutationError = ErrorType<unknown>;
/**
 * @summary Delete user (super admin only)
 */
export declare const useDeleteUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteUser>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary Approve or reject a student registration
 */
export declare const getApproveStudentUrl: (id: number) => string;
export declare const approveStudent: (id: number, approveStudentBody: ApproveStudentBody, options?: RequestInit) => Promise<User>;
export declare const getApproveStudentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveStudent>>, TError, {
        id: number;
        data: BodyType<ApproveStudentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof approveStudent>>, TError, {
    id: number;
    data: BodyType<ApproveStudentBody>;
}, TContext>;
export type ApproveStudentMutationResult = NonNullable<Awaited<ReturnType<typeof approveStudent>>>;
export type ApproveStudentMutationBody = BodyType<ApproveStudentBody>;
export type ApproveStudentMutationError = ErrorType<unknown>;
/**
 * @summary Approve or reject a student registration
 */
export declare const useApproveStudent: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof approveStudent>>, TError, {
        id: number;
        data: BodyType<ApproveStudentBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof approveStudent>>, TError, {
    id: number;
    data: BodyType<ApproveStudentBody>;
}, TContext>;
/**
 * @summary List classes
 */
export declare const getListClassesUrl: (params?: ListClassesParams) => string;
export declare const listClasses: (params?: ListClassesParams, options?: RequestInit) => Promise<Class[]>;
export declare const getListClassesQueryKey: (params?: ListClassesParams) => readonly ["/api/classes", ...ListClassesParams[]];
export declare const getListClassesQueryOptions: <TData = Awaited<ReturnType<typeof listClasses>>, TError = ErrorType<unknown>>(params?: ListClassesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listClasses>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listClasses>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListClassesQueryResult = NonNullable<Awaited<ReturnType<typeof listClasses>>>;
export type ListClassesQueryError = ErrorType<unknown>;
/**
 * @summary List classes
 */
export declare function useListClasses<TData = Awaited<ReturnType<typeof listClasses>>, TError = ErrorType<unknown>>(params?: ListClassesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listClasses>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a class (admin only)
 */
export declare const getCreateClassUrl: () => string;
export declare const createClass: (createClassBody: CreateClassBody, options?: RequestInit) => Promise<Class>;
export declare const getCreateClassMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createClass>>, TError, {
        data: BodyType<CreateClassBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createClass>>, TError, {
    data: BodyType<CreateClassBody>;
}, TContext>;
export type CreateClassMutationResult = NonNullable<Awaited<ReturnType<typeof createClass>>>;
export type CreateClassMutationBody = BodyType<CreateClassBody>;
export type CreateClassMutationError = ErrorType<unknown>;
/**
 * @summary Create a class (admin only)
 */
export declare const useCreateClass: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createClass>>, TError, {
        data: BodyType<CreateClassBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createClass>>, TError, {
    data: BodyType<CreateClassBody>;
}, TContext>;
/**
 * @summary Get class details
 */
export declare const getGetClassUrl: (id: number) => string;
export declare const getClass: (id: number, options?: RequestInit) => Promise<Class>;
export declare const getGetClassQueryKey: (id: number) => readonly [`/api/classes/${number}`];
export declare const getGetClassQueryOptions: <TData = Awaited<ReturnType<typeof getClass>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClass>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getClass>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetClassQueryResult = NonNullable<Awaited<ReturnType<typeof getClass>>>;
export type GetClassQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get class details
 */
export declare function useGetClass<TData = Awaited<ReturnType<typeof getClass>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClass>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update class (admin only)
 */
export declare const getUpdateClassUrl: (id: number) => string;
export declare const updateClass: (id: number, updateClassBody: UpdateClassBody, options?: RequestInit) => Promise<Class>;
export declare const getUpdateClassMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClass>>, TError, {
        id: number;
        data: BodyType<UpdateClassBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateClass>>, TError, {
    id: number;
    data: BodyType<UpdateClassBody>;
}, TContext>;
export type UpdateClassMutationResult = NonNullable<Awaited<ReturnType<typeof updateClass>>>;
export type UpdateClassMutationBody = BodyType<UpdateClassBody>;
export type UpdateClassMutationError = ErrorType<unknown>;
/**
 * @summary Update class (admin only)
 */
export declare const useUpdateClass: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClass>>, TError, {
        id: number;
        data: BodyType<UpdateClassBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateClass>>, TError, {
    id: number;
    data: BodyType<UpdateClassBody>;
}, TContext>;
/**
 * @summary Delete class
 */
export declare const getDeleteClassUrl: (id: number) => string;
export declare const deleteClass: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteClassMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteClass>>, TError, {
    id: number;
}, TContext>;
export type DeleteClassMutationResult = NonNullable<Awaited<ReturnType<typeof deleteClass>>>;
export type DeleteClassMutationError = ErrorType<unknown>;
/**
 * @summary Delete class
 */
export declare const useDeleteClass: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteClass>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary Start a live class
 */
export declare const getStartClassUrl: (id: number) => string;
export declare const startClass: (id: number, options?: RequestInit) => Promise<Class>;
export declare const getStartClassMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof startClass>>, TError, {
    id: number;
}, TContext>;
export type StartClassMutationResult = NonNullable<Awaited<ReturnType<typeof startClass>>>;
export type StartClassMutationError = ErrorType<unknown>;
/**
 * @summary Start a live class
 */
export declare const useStartClass: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof startClass>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary End a live class
 */
export declare const getEndClassUrl: (id: number) => string;
export declare const endClass: (id: number, options?: RequestInit) => Promise<Class>;
export declare const getEndClassMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof endClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof endClass>>, TError, {
    id: number;
}, TContext>;
export type EndClassMutationResult = NonNullable<Awaited<ReturnType<typeof endClass>>>;
export type EndClassMutationError = ErrorType<unknown>;
/**
 * @summary End a live class
 */
export declare const useEndClass: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof endClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof endClass>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary Enroll in a class (student)
 */
export declare const getEnrollInClassUrl: (id: number) => string;
export declare const enrollInClass: (id: number, options?: RequestInit) => Promise<SuccessResponse>;
export declare const getEnrollInClassMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof enrollInClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof enrollInClass>>, TError, {
    id: number;
}, TContext>;
export type EnrollInClassMutationResult = NonNullable<Awaited<ReturnType<typeof enrollInClass>>>;
export type EnrollInClassMutationError = ErrorType<unknown>;
/**
 * @summary Enroll in a class (student)
 */
export declare const useEnrollInClass: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof enrollInClass>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof enrollInClass>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary Get students enrolled in a class
 */
export declare const getGetClassEnrollmentsUrl: (id: number) => string;
export declare const getClassEnrollments: (id: number, options?: RequestInit) => Promise<User[]>;
export declare const getGetClassEnrollmentsQueryKey: (id: number) => readonly [`/api/classes/${number}/enrollments`];
export declare const getGetClassEnrollmentsQueryOptions: <TData = Awaited<ReturnType<typeof getClassEnrollments>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClassEnrollments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getClassEnrollments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetClassEnrollmentsQueryResult = NonNullable<Awaited<ReturnType<typeof getClassEnrollments>>>;
export type GetClassEnrollmentsQueryError = ErrorType<unknown>;
/**
 * @summary Get students enrolled in a class
 */
export declare function useGetClassEnrollments<TData = Awaited<ReturnType<typeof getClassEnrollments>>, TError = ErrorType<unknown>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClassEnrollments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get whiteboard state for a class
 */
export declare const getGetWhiteboardDataUrl: (classId: number) => string;
export declare const getWhiteboardData: (classId: number, options?: RequestInit) => Promise<WhiteboardData>;
export declare const getGetWhiteboardDataQueryKey: (classId: number) => readonly [`/api/whiteboard/${number}`];
export declare const getGetWhiteboardDataQueryOptions: <TData = Awaited<ReturnType<typeof getWhiteboardData>>, TError = ErrorType<unknown>>(classId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWhiteboardData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getWhiteboardData>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetWhiteboardDataQueryResult = NonNullable<Awaited<ReturnType<typeof getWhiteboardData>>>;
export type GetWhiteboardDataQueryError = ErrorType<unknown>;
/**
 * @summary Get whiteboard state for a class
 */
export declare function useGetWhiteboardData<TData = Awaited<ReturnType<typeof getWhiteboardData>>, TError = ErrorType<unknown>>(classId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWhiteboardData>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Save whiteboard state
 */
export declare const getSaveWhiteboardDataUrl: (classId: number) => string;
export declare const saveWhiteboardData: (classId: number, saveWhiteboardBody: SaveWhiteboardBody, options?: RequestInit) => Promise<WhiteboardData>;
export declare const getSaveWhiteboardDataMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveWhiteboardData>>, TError, {
        classId: number;
        data: BodyType<SaveWhiteboardBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof saveWhiteboardData>>, TError, {
    classId: number;
    data: BodyType<SaveWhiteboardBody>;
}, TContext>;
export type SaveWhiteboardDataMutationResult = NonNullable<Awaited<ReturnType<typeof saveWhiteboardData>>>;
export type SaveWhiteboardDataMutationBody = BodyType<SaveWhiteboardBody>;
export type SaveWhiteboardDataMutationError = ErrorType<unknown>;
/**
 * @summary Save whiteboard state
 */
export declare const useSaveWhiteboardData: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveWhiteboardData>>, TError, {
        classId: number;
        data: BodyType<SaveWhiteboardBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof saveWhiteboardData>>, TError, {
    classId: number;
    data: BodyType<SaveWhiteboardBody>;
}, TContext>;
/**
 * @summary Super admin dashboard stats
 */
export declare const getGetSuperAdminDashboardUrl: () => string;
export declare const getSuperAdminDashboard: (options?: RequestInit) => Promise<SuperAdminDashboard>;
export declare const getGetSuperAdminDashboardQueryKey: () => readonly ["/api/dashboard/super-admin"];
export declare const getGetSuperAdminDashboardQueryOptions: <TData = Awaited<ReturnType<typeof getSuperAdminDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSuperAdminDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSuperAdminDashboard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSuperAdminDashboardQueryResult = NonNullable<Awaited<ReturnType<typeof getSuperAdminDashboard>>>;
export type GetSuperAdminDashboardQueryError = ErrorType<unknown>;
/**
 * @summary Super admin dashboard stats
 */
export declare function useGetSuperAdminDashboard<TData = Awaited<ReturnType<typeof getSuperAdminDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSuperAdminDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Admin/teacher dashboard stats
 */
export declare const getGetAdminDashboardUrl: () => string;
export declare const getAdminDashboard: (options?: RequestInit) => Promise<AdminDashboard>;
export declare const getGetAdminDashboardQueryKey: () => readonly ["/api/dashboard/admin"];
export declare const getGetAdminDashboardQueryOptions: <TData = Awaited<ReturnType<typeof getAdminDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAdminDashboard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAdminDashboardQueryResult = NonNullable<Awaited<ReturnType<typeof getAdminDashboard>>>;
export type GetAdminDashboardQueryError = ErrorType<unknown>;
/**
 * @summary Admin/teacher dashboard stats
 */
export declare function useGetAdminDashboard<TData = Awaited<ReturnType<typeof getAdminDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Student dashboard stats
 */
export declare const getGetStudentDashboardUrl: () => string;
export declare const getStudentDashboard: (options?: RequestInit) => Promise<StudentDashboard>;
export declare const getGetStudentDashboardQueryKey: () => readonly ["/api/dashboard/student"];
export declare const getGetStudentDashboardQueryOptions: <TData = Awaited<ReturnType<typeof getStudentDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStudentDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStudentDashboard>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStudentDashboardQueryResult = NonNullable<Awaited<ReturnType<typeof getStudentDashboard>>>;
export type GetStudentDashboardQueryError = ErrorType<unknown>;
/**
 * @summary Student dashboard stats
 */
export declare function useGetStudentDashboard<TData = Awaited<ReturnType<typeof getStudentDashboard>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStudentDashboard>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Submit feedback for a class
 */
export declare const getSubmitFeedbackUrl: () => string;
export declare const submitFeedback: (submitFeedbackBody: SubmitFeedbackBody, options?: RequestInit) => Promise<SuccessResponse>;
export declare const getSubmitFeedbackMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitFeedback>>, TError, {
        data: BodyType<SubmitFeedbackBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof submitFeedback>>, TError, {
    data: BodyType<SubmitFeedbackBody>;
}, TContext>;
export type SubmitFeedbackMutationResult = NonNullable<Awaited<ReturnType<typeof submitFeedback>>>;
export type SubmitFeedbackMutationBody = BodyType<SubmitFeedbackBody>;
export type SubmitFeedbackMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Submit feedback for a class
 */
export declare const useSubmitFeedback: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof submitFeedback>>, TError, {
        data: BodyType<SubmitFeedbackBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof submitFeedback>>, TError, {
    data: BodyType<SubmitFeedbackBody>;
}, TContext>;
/**
 * @summary Get feedback for a class
 */
export declare const getGetClassFeedbackUrl: (classId: number) => string;
export declare const getClassFeedback: (classId: number, options?: RequestInit) => Promise<FeedbackItem[]>;
export declare const getGetClassFeedbackQueryKey: (classId: number) => readonly [`/api/feedback/class/${number}`];
export declare const getGetClassFeedbackQueryOptions: <TData = Awaited<ReturnType<typeof getClassFeedback>>, TError = ErrorType<unknown>>(classId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClassFeedback>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getClassFeedback>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetClassFeedbackQueryResult = NonNullable<Awaited<ReturnType<typeof getClassFeedback>>>;
export type GetClassFeedbackQueryError = ErrorType<unknown>;
/**
 * @summary Get feedback for a class
 */
export declare function useGetClassFeedback<TData = Awaited<ReturnType<typeof getClassFeedback>>, TError = ErrorType<unknown>>(classId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClassFeedback>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List support tickets
 */
export declare const getListSupportTicketsUrl: (params?: ListSupportTicketsParams) => string;
export declare const listSupportTickets: (params?: ListSupportTicketsParams, options?: RequestInit) => Promise<SupportTicket[]>;
export declare const getListSupportTicketsQueryKey: (params?: ListSupportTicketsParams) => readonly ["/api/support", ...ListSupportTicketsParams[]];
export declare const getListSupportTicketsQueryOptions: <TData = Awaited<ReturnType<typeof listSupportTickets>>, TError = ErrorType<unknown>>(params?: ListSupportTicketsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSupportTickets>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listSupportTickets>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListSupportTicketsQueryResult = NonNullable<Awaited<ReturnType<typeof listSupportTickets>>>;
export type ListSupportTicketsQueryError = ErrorType<unknown>;
/**
 * @summary List support tickets
 */
export declare function useListSupportTickets<TData = Awaited<ReturnType<typeof listSupportTickets>>, TError = ErrorType<unknown>>(params?: ListSupportTicketsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSupportTickets>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a support ticket
 */
export declare const getCreateSupportTicketUrl: () => string;
export declare const createSupportTicket: (createSupportTicketBody: CreateSupportTicketBody, options?: RequestInit) => Promise<SupportTicket>;
export declare const getCreateSupportTicketMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createSupportTicket>>, TError, {
        data: BodyType<CreateSupportTicketBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createSupportTicket>>, TError, {
    data: BodyType<CreateSupportTicketBody>;
}, TContext>;
export type CreateSupportTicketMutationResult = NonNullable<Awaited<ReturnType<typeof createSupportTicket>>>;
export type CreateSupportTicketMutationBody = BodyType<CreateSupportTicketBody>;
export type CreateSupportTicketMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Create a support ticket
 */
export declare const useCreateSupportTicket: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createSupportTicket>>, TError, {
        data: BodyType<CreateSupportTicketBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createSupportTicket>>, TError, {
    data: BodyType<CreateSupportTicketBody>;
}, TContext>;
/**
 * @summary Admin responds to a support ticket
 */
export declare const getRespondToTicketUrl: (id: number) => string;
export declare const respondToTicket: (id: number, respondToTicketBody: RespondToTicketBody, options?: RequestInit) => Promise<SupportTicket>;
export declare const getRespondToTicketMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof respondToTicket>>, TError, {
        id: number;
        data: BodyType<RespondToTicketBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof respondToTicket>>, TError, {
    id: number;
    data: BodyType<RespondToTicketBody>;
}, TContext>;
export type RespondToTicketMutationResult = NonNullable<Awaited<ReturnType<typeof respondToTicket>>>;
export type RespondToTicketMutationBody = BodyType<RespondToTicketBody>;
export type RespondToTicketMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Admin responds to a support ticket
 */
export declare const useRespondToTicket: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof respondToTicket>>, TError, {
        id: number;
        data: BodyType<RespondToTicketBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof respondToTicket>>, TError, {
    id: number;
    data: BodyType<RespondToTicketBody>;
}, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map